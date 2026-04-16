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
  `editor`). Each exports a typed `ToolDef[]` and a
  `register(server, bridge, profile = "full")` function. `ToolDef` is defined
  in `tools/scene.ts` and re-exported implicitly (via
  `import { ToolDef } from "./scene.js"`). Tools filter via `includesInProfile`
  (see `src/types.ts`) so that `--lite` exposes the 16-tool core subset only.
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

## Tool-catalogue profiles (iter 15)

- **Full** (default) — every tool in the catalogue (28 by default; 29 with
  `GODOT_MCP_ALLOW_GAME_EVAL=1`).
- **Lite** — 16-tool token-sensitive subset; opt in by passing `--lite` in
  `.mcp.json` args. The exact list lives in `LITE_CORE` (`src/types.ts`) —
  keep that set as the single source of truth; do not replicate it elsewhere.
  `scene_create` is included (clean-start projects need a way to bootstrap a
  `.tscn`); `scene_delete` + `script_delete` are cleanup-only and deliberately
  excluded. Iter 22 replaces this coarse flag with a richer profile system.

## Idempotency — status discriminator (iter 15)

Every `create_*` success payload carries a `status` field:

- `"created"` — fresh create.
- `"returned"` — idempotent no-op; the thing already existed. This is the
  default silent-success path for `scene_create_node`, `signal_connect`, and
  `scene_create` (with the default `if_exists: "return"`).
- `"replaced"` — file-level `scene_create` with `if_exists: "replace"` only;
  the response also carries `previous_root_type`.

Success payloads do NOT carry `code` — `status` is the single discriminator
consumers check. `code` is reserved for error payloads.

`scene_create` accepts `if_exists: "return" | "fail" | "replace"`:
- `"return"` (default) — idempotent no-op, payload `{ status: "returned", path }`.
- `"fail"` — hard error `ALREADY_EXISTS` with a message suggesting `replace`.
- `"replace"` — overwrite, payload `{ status: "replaced", path, root_type, previous_root_type }`.

Node-level creates (`scene_create_node`, `signal_connect`) intentionally do
NOT accept `if_exists` — their blast radius is small and silent-success is
the right default. If a future create tool gains the param, copy this shape
(zod `z.enum(["return","fail","replace"]).optional()`, toolkit-side default
`"return"`, three-branch switch in the GDScript handler).

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
3. If the tool belongs in the lite-profile core, add its name to `LITE_CORE`
   in `src/types.ts`. Otherwise it's full-only by default (the `register()`
   filter via `includesInProfile` takes care of gating).
4. If the tool returns non-text content (images, binary), handle it explicitly
   in that group's `register()` function — see `editor.ts` `editor_screenshot`
   for the image path.
5. Add a smoke-test round-trip assertion under the existing ones in
   `test/smoke.ts`, appended (never re-ordered — port-check must stay first).
6. Update the tool count in the smoke-test assertion and the toolkit-repo
   `CLAUDE.md` "tool list" section.

## Error code reference (I1)

Canonical `ErrorCode` union lives in `src/types.ts` (single source of truth on
this side; mirrored as `MCP_ERROR_CODES` in the toolkit-repo `mcp_server.gd` +
`mcp_runtime_server.gd`). Adding a new code requires updating BOTH sides AND
this table. Codes are UPPER_SNAKE_CASE.

| Code               | Origin           | When                                                                          |
|--------------------|------------------|-------------------------------------------------------------------------------|
| `ALREADY_EXISTS`   | plugin           | `scene_create` with `if_exists: "fail"` on collision. **Error payload only** post-iter-15 — idempotent collisions now return success with `status: "returned"`. |
| `CLOSED`           | bridge           | Bridge call after `bridge.close()`.                                           |
| `CONNECT_FAILED`   | bridge           | WebSocket open failure (cold path; first attempt).                            |
| `DELETE_FAILED`    | plugin (iter 15) | `DirAccess.remove` returned non-OK from `scene_delete` / `script_delete`.     |
| `DISCONNECTED`     | bridge           | Socket closed mid-call or no reconnect within `CALL_AWAIT_RECONNECT_MS`.      |
| `EDITED_SCENE`     | plugin (iter 15) | `scene_delete` against the currently-edited scene; open a different scene first. |
| `EXECUTE_FAILED`   | plugin (Mode B)  | `game.eval` Expression.execute returned an error.                             |
| `FEATURE_DISABLED` | both (iter 19+)  | Tool gated off by FeatureGate; reserved.                                      |
| `FILE_TOO_LARGE`   | plugin (iter 20) | Response cap exceeded; reserved.                                              |
| `GAME_NOT_RUNNING` | bridge           | Mode B call when port 9090 isn't listening.                                   |
| `INTERNAL`         | both             | Catch-all for unexpected failure (viewport unavailable, save_png empty, …).   |
| `INVALID_CLASS`    | plugin           | `ClassDB` rejection (unknown / not instantiable / not a Node subclass).       |
| `INVALID_PARAMS`   | plugin           | JSON-RPC params shape error (missing required field, wrong type).             |
| `INVALID_PATH`     | plugin           | Semantic refusal — edited-root on `scene_delete_node`, or wrong prefix/extension on `scene_create` / `scene_delete` / `script_delete`. |
| `LOAD_FAILED`      | plugin           | `ResourceLoader.load` returned null.                                          |
| `NO_RUNTIME_URL`   | bridge           | `callRuntime` invoked when `createBridge` got no runtime URL.                 |
| `NO_SCENE`         | plugin           | `EditorInterface.get_edited_scene_root()` returned null.                      |
| `NOT_FOUND`        | plugin           | Node / scene file / resource / animation / connection not found.              |
| `PACK_FAILED`      | plugin (iter 15) | `PackedScene.pack(root)` returned non-OK — only `scene_create` emits this.    |
| `PARENT_NOT_FOUND` | plugin (iter 15) | `scene_create` target's parent dir does not exist (pre-FileGuard guard).      |
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
