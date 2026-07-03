# Integration tests (manual — require a running Godot editor)

The dispatch suites connect **directly** to the toolkit's WebSocket server
(bypassing the MCP bridge), so they need a live Godot editor with the MCP
toolkit plugin enabled, opened on the toolkit dogfood project. The port-pin
probe is the exception: it drives the **shipped server** (`dist/index.js`) over
MCP stdio end-to-end. None of these are part of CI.

| What | Command | Purpose |
|------|---------|---------|
| **Dispatch suite** | `GODOT_MCP_TOKEN=<t> npm run test:integration:dispatch` | 7 pass/fail flows: mutation ordering, read bypass, FIFO drain, notification timing, cancellation, peer disconnect, scene lease. |
| **Dispatch-safety stress driver** | `GODOT_MCP_TOKEN=<t> npm run stress:dispatch -- [flags]` | Self-detecting crash/hang hammer for the deferred-dispatch race fixes. |
| **Port-pin probe** | `npm run test:integration:portpin -- [flags]` | End-to-end pinned-port regression probe against `dist/index.js`: pin connect (env + CLI), fail-fast desync message, runtime-pin inheritance. |

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

Example invocations (mirroring the live proofs; editor open on `<project>`,
toolkit listening on `6591`):

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
