# CLAUDE.md — godot-mcp-server

Guidance for Claude Code (claude.ai/code) when **editing this repo's TypeScript
source**. If you are instead calling MCP tools from the plugin, see the toolkit
repo's `CLAUDE.md` (user-facing tool list + conventions).

---

## What this repo is

The TypeScript MCP server that bridges Claude Code (stdio) to the `godot-mcp-toolkit`
Godot editor plugin (WebSocket `127.0.0.1:6505`). Repo root IS the npm package
root — no `server/` subdir wrapper. Distributed via `npm install -g @npgamedev/godot-mcp-server`
(or `npx -y @npgamedev/godot-mcp-server`).

## Architecture

- `src/index.ts` — entry. Constructs one `McpServer`, one `Bridge`, registers
  tool groups, connects the `StdioServerTransport`.
- `src/bridge.ts` — WebSocket client (lazy-connect, pending-map keyed by uuid,
  per-call timeout). Exposes `Bridge.call(method, params, timeoutMs)` and `close()`.
- `src/types.ts` — `Bridge` interface + `BridgeError` class. Tool modules depend
  on `Bridge`, NOT on the concrete `createBridge` function (DIP).
- `src/tools/<group>.ts` — one file per logical group (`scene`, `node`, `script`,
  `editor`). Each exports a typed `ToolDef[]` and a `register(server, bridge)`
  function. `ToolDef` is defined in `tools/scene.ts` and re-exported implicitly
  (via `import { ToolDef } from "./scene.js"`).
- `test/smoke.ts` — harness. **Port-check first** (iter 05 contract) then round-trip
  assertions. Do NOT move the port-check below the assertions — it exits with
  instructions when the editor is down.

## Invariants for agents editing this repo

- **I1 — error contract.** Tools never throw past the bridge. Plugin-side errors
  come back as `{ success: false, error, code }` payloads; wrap them into MCP
  responses with `isError: true`. Use the helpers in `src/types.ts`:
  `callAndWrap` for single-bridge-call handlers (default), `toolErrorFromException`
  + `toolErrorFromPayload` for custom handlers (screenshots).
  See **Error code reference** below for the canonical `ErrorCode` list.
- **I2 — description ≤ 200 chars.** Enforced by smoke. Tight descriptions help
  Claude Code pick the right tool.
- **I4 — path rule.** All `res://` path input eventually passes through
  `FileGuard.resolve_safe` (plugin side, iter 18). For now, callers leave
  `TODO(iter-18)` at each path-touching call site.
- **I6 — localhost-only.** Bridge URL is `ws://127.0.0.1:${GODOT_MCP_PORT}`.
  Never allow a non-loopback host.
- **I7 — one commit per iteration per repo.** Conventional-commit form:
  `feat(server): …`, `fix(server): …`, `refactor(server): …`.
- **I8 — rollback granularity.** `git revert <sha>` cleanly undoes one iteration's
  server-side work.

## Workflow

```
npm install          # once
npm run build        # tsc -> dist/, postbuild adds shebang
npm run smoke        # port-check + round-trip assertions (editor must be up)
npm link             # dogfood: global `godot-mcp-server` resolves to this dist/
```

Pre-iter-20 dogfood runs against a locally-built `dist/` via a path-based
`.mcp.json` in the toolkit repo + `godot-mcp-dogfood-playground/` (not `npm
link`, because `@npgamedev/godot-mcp-server` is not yet published). Iter 20
publishes to npm and swaps the toolkit `.mcp.json` + template back to
`npx -y @npgamedev/godot-mcp-server` — at which point the same config works
for end users with no further edits. See iter 13b + iter 20 in the plan repo.

## Adding a tool

1. Append a `ToolDef` to the appropriate group file (`src/tools/<group>.ts`).
2. Keep `description` ≤ 200 chars (I2).
3. If the tool returns non-text content (images, binary), handle it explicitly
   in that group's `register()` function — see `editor.ts` `editor_screenshot`
   for the image path.
4. Add a smoke-test round-trip assertion under the existing ones in
   `test/smoke.ts`, appended (never re-ordered — port-check must stay first).
5. Update the tool count in the smoke-test assertion and the toolkit-repo
   `CLAUDE.md` "tool list" section.

## Error code reference (I1)

Canonical `ErrorCode` union lives in `src/types.ts` (single source of truth on
this side; mirrored as `MCP_ERROR_CODES` in the toolkit-repo `mcp_server.gd` +
`mcp_runtime_server.gd`). Adding a new code requires updating BOTH sides AND
this table. Codes are UPPER_SNAKE_CASE.

| Code               | Origin           | When                                                                          |
|--------------------|------------------|-------------------------------------------------------------------------------|
| `ALREADY_EXISTS`   | plugin (I3)      | Idempotent `create_*` collision. **Non-error success**, NOT wrapped as isError. |
| `CLOSED`           | bridge           | Bridge call after `bridge.close()`.                                           |
| `CONNECT_FAILED`   | bridge           | WebSocket open failure (cold path; first attempt).                            |
| `DISCONNECTED`     | bridge           | Socket closed mid-call or no reconnect within `CALL_AWAIT_RECONNECT_MS`.      |
| `EXECUTE_FAILED`   | plugin (Mode B)  | `game.eval` Expression.execute returned an error.                             |
| `FEATURE_DISABLED` | both (iter 19+)  | Tool gated off by FeatureGate; reserved.                                      |
| `FILE_TOO_LARGE`   | plugin (iter 20) | Response cap exceeded; reserved.                                              |
| `GAME_NOT_RUNNING` | bridge           | Mode B call when port 9090 isn't listening.                                   |
| `INTERNAL`         | both             | Catch-all for unexpected failure (viewport unavailable, save_png empty, …).   |
| `INVALID_CLASS`    | plugin           | `ClassDB` rejection (unknown / not instantiable / not a Node subclass).       |
| `INVALID_PARAMS`   | plugin           | JSON-RPC params shape error (missing required field, wrong type).             |
| `INVALID_PATH`     | plugin           | Semantic refusal (e.g. `scene_delete_node` against the edited scene root).    |
| `LOAD_FAILED`      | plugin           | `ResourceLoader.load` returned null.                                          |
| `NO_RUNTIME_URL`   | bridge           | `callRuntime` invoked when `createBridge` got no runtime URL.                 |
| `NO_SCENE`         | plugin           | `EditorInterface.get_edited_scene_root()` returned null.                      |
| `NOT_FOUND`        | plugin           | Node / scene file / resource / animation / connection not found.              |
| `PARSE_ERROR`      | plugin (Mode B)  | `game.eval` Expression.parse failed.                                          |
| `PATH_DENIED`      | plugin           | Path didn't pass the `res://` prefix check (full FileGuard in iter 18).       |
| `READ_FAILED`      | plugin           | `FileAccess` read error.                                                      |
| `RPC_ERROR`        | bridge           | Plugin returned a JSON-RPC envelope `error` field (transport-level).          |
| `SAVE_FAILED`      | plugin           | `EditorInterface.save_scene` / `save_scene_as` failure.                       |
| `SEND_FAILED`      | bridge           | WebSocket send callback errored.                                              |
| `TIMEOUT`          | bridge           | Per-call timer fired before response.                                         |
| `WRITE_FAILED`     | plugin           | `FileAccess.open(WRITE)` failed.                                              |

## Pointers

- Execution plan (all 26 iterations, cross-repo): `<plan-repo>/Plan/ExecutionPlan/00-index.md`
- Companion plugin: `<toolkit-repo>/` — see its `CLAUDE.md` for tool usage.
- Distribution procedure: `<toolkit-repo>/DISTRIBUTION.md`.
