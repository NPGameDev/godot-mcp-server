# Integration tests (manual — require a running Godot editor)

The dispatch suites connect **directly** to the toolkit's WebSocket server
(bypassing the MCP bridge), so they need a live Godot editor with the MCP
toolkit plugin enabled, opened on the toolkit dogfood project. Two harnesses are
exceptions: the port-pin probe drives the **shipped server** (`dist/index.js`)
over MCP stdio end-to-end, and the LSP-conflict repro runs **without any editor**
in its default mode. None of these are part of CI.

| What | Command | Purpose |
|------|---------|---------|
| **Dispatch suite** | `GODOT_MCP_TOKEN=<t> npm run test:integration:dispatch` | 7 pass/fail flows: mutation ordering, read bypass, FIFO drain, notification timing, cancellation, peer disconnect, scene lease. |
| **Dispatch-safety stress driver** | `GODOT_MCP_TOKEN=<t> npm run stress:dispatch -- [flags]` | Self-detecting crash/hang hammer for the deferred-dispatch race fixes. |
| **Port-pin probe** | `npm run test:integration:portpin -- [flags]` | End-to-end pinned-port regression probe against `dist/index.js`: pin connect (env + CLI), fail-fast desync message, runtime-pin inheritance. |
| **LSP-conflict repro** | `npm run repro:lsp-conflict [-- --live …]` | Two-peer proof that LSP claimant liveness *discriminates*: a dead editor's leftover entry must not contest the port, a genuinely-live rival still must. |

Read the token from the toolkit's MCP dock, or from
`%APPDATA%/Godot/app_userdata/<project>/addons/godot_mcp_toolkit/project_instance_<hash>/mcp_token`.
Set `GODOT_MCP_EDITOR_PORT` for a non-default port (default `6550`).

## The stress driver is red-green; the pre-fix commit is the control

`dispatch-safety-stress.ts` deliberately tries to **crash a running editor** by
racing the deferred-dispatch pipeline against a scene save's re-entrant frame
pump (C1) and an in-flight filesystem scan (C2).

**It detects the crash for you — you do not have to watch the editor.** A
dedicated monitor connection runs alongside the storm and (1) reports a crash
the moment its WebSocket drops (editor process died) and (2) every
`--health-interval` ms fires a cheap *scene-independent* read
(`project.get_settings`, which bypasses the dispatch lock and scene queue) and
waits up to `--health-timeout` ms for the reply — no reply means the editor's
main loop is wedged (deadlock/freeze) even though the process is still alive,
which a plain socket-drop check would miss. The run **exits 1 on a detected
crash/hang (RED), 0 if none (GREEN), 2 on a precondition failure**, and prints
which scenario tripped it.

It was committed **before** the toolkit fix, against the pre-fix toolkit, and
shown to crash on Godot 4.2 **and** 4.5 (**RED ⇒ exit 1**). That pre-fix commit
**is** the reproducible control — `git checkout` it to reproduce the crash; no
separate clone needed. The same, unchanged driver must then detect **zero**
crashes on 4.2 and 4.5 against the fixed toolkit (**GREEN ⇒ exit 0**). A green
that was never red proves nothing: if a scenario does not crash the pre-fix
editor, raise `--iterations` / `--burst` until it does.

Run **one** editor version at a time (4.2, then 4.5) — two editors bind
different ports/tokens. See the header comment in `dispatch-safety-stress.ts`
for full flag and scenario documentation.

## Port-pin probe (`port-pin-probe.ts`)

Regression harness for the deterministic port configuration: it spawns the
built server (`node dist/index.js`) with a pinned port config, drives one MCP
`tools/call` over newline-delimited stdio JSON-RPC (initialize →
`notifications/initialized` → `tools/call`), and prints the server's resolved
`port config:` stderr line plus the tool result. It proves three things:

1. a **pinned editor port connects** — by env var AND by server CLI flag
   (`--via env|cli` selects how the pin reaches the server; the shared resolver
   must treat both identically),
2. a **deliberate pin/editor desync fails fast** with the precise cross-check
   message instead of a dead-socket hang,
3. a **runtime pin** (`GODOT_MCP_RUNTIME_PORT`) is inherited end-to-end and
   reaches the playtest child.

The probe is result-agnostic: it exits **0** whenever the call returns — an
error envelope can be the *expected* outcome (the desync run below) — and **2**
on timeout, early server exit, or a bad invocation. Run `npm run build` first
(it probes `dist/`, not `src/`). No `GODOT_MCP_TOKEN` needed — the server
resolves the token itself. **Precondition:** a running editor with the toolkit
plugin for the connect/runtime proofs (the desync run needs the editor too —
live on a *different* port — for the "listening on Y" variant of the message).

Flags: `--tool <name>` (default `project_get_settings`), `--args <json>`
(default `{}`), `--editor-port <n>`, `--runtime-port <n>`,
`--project-path <abs>` (defaults to `GODOT_MCP_PROJECT_PATH` from the caller's
env — set one of the two, or the server falls back to the repo cwd, which is
not a Godot project), `--via env|cli` (default `env`), `--timeout <ms>`
(default `60000`).

Example invocations for the port-pin probe (mirroring the live proofs; editor open
on `<project>`, toolkit listening on `6591`):

```bash
# 1. Pin-match connect — expect "editor=6591 [env]" (then "[cli]") in the
#    port-config line and a real settings payload.
npm run test:integration:portpin -- --editor-port 6591 --project-path <project>
npm run test:integration:portpin -- --editor-port 6591 --project-path <project> --via cli

# 2. Deliberate desync — pin a port nobody holds while the editor is live on
#    6591; expect the fail-fast cross-check error, not a hang:
#    "pinned to port 6599, but the live editor for this project is listening
#     on 6591 — launch the editor with the same GODOT_MCP_EDITOR_PORT …"
npm run test:integration:portpin -- --editor-port 6599 --project-path <project>

# 3. Runtime-pin inheritance — launch the EDITOR from a shell that exported
#    GODOT_MCP_RUNTIME_PORT=6593 (listen side), then start the game and hit the
#    runtime channel through the same pin (connect side). Any runtime tool
#    (e.g. debugger_get_log) exercises the pinned runtime channel.
npm run test:integration:portpin -- --editor-port 6591 --runtime-port 6593 --project-path <project> --tool game_start
npm run test:integration:portpin -- --editor-port 6591 --runtime-port 6593 --project-path <project> --tool debugger_get_log
```

## LSP-conflict repro (`lsp-conflict-repro.ts`)

**What it measures:** whether the server's GDScript-LSP endpoint resolution can
tell a **dead editor's leftover registry entry** apart from a **genuinely-live
rival editor**. Both look identical to a verdict built on PID liveness alone,
because PIDs are a bounded, recycled resource — so a closed editor's entry
becomes a phantom "live claimant" the moment its recorded number is handed to
some unrelated process. That is what made a project served by *one* editor report
a false `LSP_PORT_CONFLICT` (and a false `LSP_UNAVAILABLE` on the registry-miss
path, which shares the same predicate).

**Which fix it backs:** the claimant predicate in `registry.liveLspClaimants` —
a claimant counts only when it is pid-alive **and** answering on the WS command
port its own entry advertises (`registryLiveness.ts`). The harness proves the
guard *discriminates* rather than merely suppresses, so re-run it after any change
to that predicate, to `discoverLspEndpoint`, or to `resolveLspEndpoint`.

Two synthetic peers, and the fix must make them **diverge**:

| Peer | PID | Its WS port | Correct verdict |
|------|-----|-------------|-----------------|
| **Phantom** — dead editor, recycled PID | a child the harness spawns | reserved, then released → refuses | **not** a conflict |
| **Genuine** — a real second editor | a child the harness spawns | held open by the harness | conflict |

The spawned child is what removes the flakiness: a PID that is provably alive and
provably not a Godot editor — a deterministic stand-in for a recycled PID, with
no waiting for the OS to recycle one. WS ports are **OS-assigned ephemeral
ports**, never the literal `6550`/`6552`/`6553` of the captured evidence, so a
real editor on the machine can neither rescue nor break a leg. The fixture is
written in the toolkit's verbatim on-disk shape (tab indent, and `_key` in
`normalizePath` form — lowercased on Windows and macOS, case-preserving
elsewhere). Numerics are emitted in **both** real spellings: Godot 4.5+ writes
every number as a GDScript float (`6553.0`), 4.2 writes plain integers, so the
three-row evidence fixture carries one row of each rather than assuming a single
shape. `entries/` is written for shape fidelity only — the server reads the
aggregate `projects.json` and never the per-instance files.

Modes:

- **`--offline`** (default, **no editor needed**) — redirects the registry env
  var to a temp sandbox, writes a `projects.json` + `entries/`, and calls the real
  `discoverLspEndpoint` / `resolveLspEndpoint` / `getLspStatus` in-process. Six
  legs cover the conflict path, the registry-miss path, the dock verdict, the
  captured three-row evidence shape, and a genuine peer standing *behind* a
  phantom one (which must still conflict).
- **`--live`** (needs a running editor with the toolkit on the target project) —
  clones the **real** registry into the sandbox, splices a phantom claimant in,
  spawns `dist/index.js` against the sandbox, and drives a real `lsp_symbols` over
  MCP stdio. The harness process redirects its own registry env var too (that is how
  it locates the clone it edits), but every write lands inside the sandbox: the real
  `projects.json` is only ever read, so there is nothing to back up or restore. Run
  `npm run build` first.

**Exit codes:** `0` every expectation held · `1` an expectation failed (the false
positive is present, or a regression) · `2` the harness could not run (bad
invocation, missing `dist/`, no live editor). There is deliberately **no**
inverted "expect the bug" flag — against unfixed code the run simply exits `1`,
and *that* is the proof.

```bash
# Offline — the acceptance run. No editor, no build.
npm run repro:lsp-conflict

# Live — end-to-end through the shipped server against a running editor.
npm run build
npm run repro:lsp-conflict -- --live --project-path <abs-project-path>

# Live, pointing at a different .gd (default: the toolkit's own plugin.gd).
npm run repro:lsp-conflict -- --live --project-path <abs> --file-path res://scripts/player.gd
```

Flags: `--offline` (default), `--live`, `--project-path <abs>` (live; falls back
to `GODOT_MCP_PROJECT_PATH`), `--file-path <res://…>` (live; default
`res://addons/godot_mcp_toolkit/plugin.gd`), `--timeout <ms>` (default `60000`).

In `--live` mode the harness also prints a reminder to check the editor's Output
dock: corroboration probes close with a graceful FIN, so no `accept_stream
failed` line should appear.
