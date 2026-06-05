# Integration tests (manual — require a running Godot editor)

These tests connect **directly** to the toolkit's WebSocket server (bypassing
the MCP bridge), so they need a live Godot editor with the MCP toolkit plugin
enabled, opened on the toolkit dogfood project. They are **not** part of CI.

| What | Command | Purpose |
|------|---------|---------|
| **Dispatch suite** | `GODOT_MCP_TOKEN=<t> npm run test:integration:dispatch` | 7 pass/fail flows: mutation ordering, read bypass, FIFO drain, notification timing, cancellation, peer disconnect, scene lease. |
| **Dispatch-safety stress driver** | `GODOT_MCP_TOKEN=<t> npm run stress:dispatch -- [flags]` | Self-detecting crash/hang hammer for the deferred-dispatch race fixes (41l-tricies). |

Read the token from the toolkit's MCP dock, or from
`%APPDATA%/Godot/app_userdata/<project>/addons/godot_mcp_toolkit/project_instance_<hash>/mcp_token`.
Set `GODOT_MCP_PORT` for a non-default port (default `6550`).

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
