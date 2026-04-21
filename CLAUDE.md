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

- `src/index.ts` — entry. Resolves profile/readOnly, constructs `McpServer` +
  `Bridge`, registers tools per profile, connects `StdioServerTransport`.
- `src/bridge.ts` — WebSocket client (lazy-connect, pending-map keyed by uuid,
  per-call timeout). Exposes `Bridge.call(method, params, timeoutMs)` and `close()`.
- `src/types.ts` — `Bridge` interface, `BridgeError`, `ToolDef`, `callAndWrap`
  (uses `stableStringify` for deterministic output), `toolError*` helpers.
- `src/profiles.ts` — profile resolution (`selectedProfile`, `resolveAllowedTools`,
  `isReadOnly`). Defines `MINIMAL_TOOLS`, `STANDARD_TOOLS`, `MUTATING_TOOLS`.
- `src/groups.ts` — lazy-load group system. `registerGroupSystem` (standard/custom)
  or `registerAllGroupTools` (full). `enable_tool_group` meta-tool + `GROUP_TOOL_NAMES`.
- `src/stubs.ts` — locked stubs for gated tools. `registerStubs(server, profile)`.
- `src/feature_gate.ts` — env-var-only gate checks (`isEnabled`, `envVarFor`).
- `src/schema_min.ts` — `minifySchema` + `stableStringify` (sorted-key JSON for
  prompt-cache hits).
- `src/tools/<group>.ts` — one file per logical group (`scene`, `node`, `script`,
  `editor`, `resource`, `folder`, `signals`, `diff`, `runtime`, `playtest`,
  `input_map`, `animation`, `tilemap`, `asset`, `file`, `save`, `classdb`).
  Each exports a typed `ToolDef[]` (with MCP annotations) and a
  `register(server, bridge, allowedTools)` function. Tools filter via the
  `allowedTools` Set.
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

## Tool-catalogue profiles (iter 22)

Three-axis system: **profiles** control safe-tool visibility, **groups**
enable specialized tools on demand, **stubs** expose locked gates.

### Profiles (`GODOT_MCP_PROFILE` env var)

| Profile      | Behaviour | Default tools |
|--------------|-----------|---------------|
| **standard** (default) | 32 core tools + `enable_tool_group` meta-tool + 3 locked stubs = 36 in `tools/list`. Groups loaded on demand. | `src/profiles.ts` → `STANDARD_TOOLS` |
| **minimal** | 11 read-only tools. No groups, no stubs, no meta-tool. Good for code review. | `MINIMAL_TOOLS` |
| **full**     | All 57 tools registered at startup (group tools eager-loaded, no meta-tool). | Everything passing its feature gate. |
| **custom**   | Comma-separated tool list via `GODOT_MCP_CUSTOM_TOOLS` env var. | Whatever you list. |

`--lite` still works but maps to `minimal` with a deprecation warning.

`GODOT_MCP_READ_ONLY=1` removes all tools in the `MUTATING_TOOLS` set from
any profile. Single source of truth: `src/profiles.ts`.

### Lazy-load groups (standard / custom profiles)

Six groups (22 tools total) loaded via `enable_tool_group`:

| Group                 | Tools | Gate |
|-----------------------|-------|------|
| `runtime`             | `runtime_screenshot`, `runtime_get_node_state`, `debugger_get_log`, `input_simulate`, `animation_player_control` | — |
| `signals`             | `signal_list`, `signal_manage`, `signal_emit` | — |
| `animation_authoring` | `animation_keyframe`, `animation_get_keys` | — |
| `input_map`           | `input_map_action`, `input_map_event` | `GODOT_MCP_ALLOW_INPUT_MAP_WRITE` |
| `asset_management`    | `asset_get_dependencies`, `asset_import`, `resource_delete`, `file_delete`, `scene_delete`, `scene_close` | — |
| `user_data`           | `save_read`, `save_write`, `save_delete`, `save_list` | `GODOT_MCP_ALLOW_USER_SCOPE` |

Groups persist for the session. Gated groups require their env var.
Source of truth: `src/groups.ts`.

### Locked stubs

For standard/full/custom profiles, gated tools whose gate is closed appear
as `LOCKED —` stubs in `tools/list` so the model can discover them and
tell the user how to enable. Stubs defined in `src/stubs.ts`.

## Feature gates (iter 19)

Seven features are gated behind explicit opt-in via env vars. The TS side
controls MCP catalogue visibility only (env-var check at registration
time); the plugin side performs the full dual/single-gate check as
defence-in-depth.

| Feature               | Gate type | Env var                                  | Tools affected |
|-----------------------|-----------|------------------------------------------|----------------|
| `game_eval`           | dual      | `GODOT_MCP_ALLOW_GAME_EVAL`             | `game_eval` (runtime) |
| `os_execute`          | dual      | `GODOT_MCP_ALLOW_OS_EXECUTE`            | (future) |
| `project_set_setting` | dual      | `GODOT_MCP_ALLOW_PROJECT_SET_SETTING`   | `project_set_setting` |
| `outbound_http`       | dual      | `GODOT_MCP_ALLOW_OUTBOUND_HTTP`         | (future) |
| `node_call_method`    | single    | `GODOT_MCP_ALLOW_NODE_CALL_METHOD`      | `node_call_method` |
| `input_map_write`     | single    | `GODOT_MCP_ALLOW_INPUT_MAP_WRITE`       | `input_map_action`, `input_map_event` |
| `read_user_scope`     | dual      | `GODOT_MCP_ALLOW_USER_SCOPE`            | `save_read`, `save_write`, `save_delete`, `save_list` |

Gate logic lives in `src/feature_gate.ts`. Each tool module's exported array
conditionally pushes gated tools based on `isEnabled(feature)`.

Default tool count (standard profile): 32 + meta-tool + 3 stubs = 36 in
`tools/list`. Full profile with all gates: 57 tools.

### Dual-pass smoke runner (`npm run smoke`)

`test/run-smoke.ts` runs `test/smoke.ts` twice in child processes:

1. **Pass 1 — ALL GATES OFF**: no `GODOT_MCP_ALLOW_*` env vars.
   Verifies the base catalogue (49 tools), gated sections skip gracefully.
2. **Pass 2 — ALL GATES ON**: all gate env vars set to `"1"` plus
   `MCP_ENABLE_USER_SCOPE=1`. Verifies the expanded catalogue (up to 60).
   Sections that hit a Godot-side dual-gate rejection (`FEATURE_DISABLED`)
   skip rather than fail — the TS-side gate is confirmed, but the
   ProjectSettings side may not be configured in this editor instance.

Both passes set `GODOT_MCP_PROJECT_NAME` so token resolution works when
CWD is the server repo (not the Godot project root).

Use `npm run smoke:single` for a single pass that inherits whatever
env vars the caller provides (useful for debugging a specific gate
configuration).

### Conditional smoke for user-scope tools

The smoke test exercises `save.*` round-trips only when
`MCP_ENABLE_USER_SCOPE=1` is set. This env var is intentionally distinct
from `GODOT_MCP_ALLOW_USER_SCOPE` — running the gate'd tests requires
both: (a) Godot launched with the gate enabled AND (b) the smoke harness
told to exercise them. Without `MCP_ENABLE_USER_SCOPE=1`, the smoke test
logs a skip message and proceeds. Even with both env vars set, the
Godot-side dual gate or a missing whitelist file may reject — the test
detects `FEATURE_DISABLED` / `USER_SCOPE_DISABLED` and skips gracefully.

## Idempotency — status discriminator (iter 15 / 15b)

Every `create_*` success payload carries a `status` field:

- `"created"` — fresh create.
- `"returned"` — idempotent no-op; the thing already existed. This is the
  default silent-success path for `scene_create_node`, `signal_connect`,
  `folder_create`, and file-level `scene_create` / `resource_create` with
  the default `if_exists: "return"`.
- `"replaced"` — file-level `scene_create` / `resource_create` with
  `if_exists: "replace"` only; the response also carries
  `previous_root_type` / `previous_class` respectively.

`resource_save` is the odd one out: it is an UPDATE, not a create, so it
carries NO `status` field. The absence is itself the discriminator between
create and update paths (`resource_create` has `status`; `resource_save`
does not).

Success payloads do NOT carry `code` — `status` is the single discriminator
consumers check. `code` is reserved for error payloads.

File-level creates (`scene_create`, `resource_create`) accept
`if_exists: "return" | "fail" | "replace"`:
- `"return"` (default) — idempotent no-op. `{ status: "returned", path }`
  for `scene_create`; `{ status: "returned", path, class }` for
  `resource_create`.
- `"fail"` — hard error `ALREADY_EXISTS` with a message suggesting `replace`.
- `"replace"` — overwrite. `{ status: "replaced", path, root_type,
  previous_root_type }` for `scene_create`; `{ status: "replaced", path,
  class, previous_class, properties, warnings }` for `resource_create`.

Node-level creates (`scene_create_node`, `signal_connect`, `folder_create`)
intentionally do NOT accept `if_exists` — their blast radius is small and
silent-success is the right default. If a future create tool gains the
param, copy this shape (zod `z.enum(["return","fail","replace"]).optional()`,
toolkit-side default `"return"`, three-branch switch in the GDScript
handler).

## Environment variables (non-gate)

| Variable                    | Default                 | Purpose |
|-----------------------------|-------------------------|---------|
| `GODOT_MCP_PORT`            | `6505`                  | Editor WebSocket port |
| `GODOT_MCP_RUNTIME_PORT`    | `9090`                  | Game runtime WebSocket port |
| `GODOT_MCP_TOKEN_PATH`      | (resolved from project) | Absolute override for the session-token file |
| `GODOT_MCP_PROJECT_NAME`    | (read from project.godot, else `[unnamed project]`) | Godot project name used to locate the token file under Godot's `app_userdata/` dir. Set this when the server is launched from a CWD that is not the Godot project root (e.g. CI, smoke harness). |

## Workflow

```
npm install          # once
npm run build        # tsc -> dist/, postbuild adds shebang
npm run smoke        # dual-pass: gates-off then gates-on (editor must be up)
npm run smoke:single # single-pass (inherits env vars from caller)
npm link             # dogfood: global `godot-mcp-server` resolves to this dist/
```

Pre-iter-20 dogfood runs against a locally-built `dist/` via a path-based
`.mcp.json` in the toolkit repo + `godot-mcp-dogfood-playground/` (not `npm
link`, because `@npgamedev/godot-mcp-server` is not yet published). Iter 20
publishes to npm and swaps the toolkit `.mcp.json` + template back to
`npx -y @npgamedev/godot-mcp-server` — at which point the same config works
for end users with no further edits. See iter 13b + iter 20 in the plan repo.

## Adding a tool

1. Append a `ToolDef` to the appropriate module file (`src/tools/<group>.ts`).
   Include `annotations` (readOnlyHint, destructiveHint, idempotentHint,
   openWorldHint: false).
2. Keep `description` ≤ 200 chars (I2).
3. Decide placement: add the tool's name to `STANDARD_TOOLS` (standard profile),
   or to a group's `tools` array in `src/groups.ts` (lazy-loaded), or leave it
   full-only (only visible in the `full` profile). Gated tools go in their
   module's conditional push block.
4. If the tool returns non-text content (images, binary), handle it explicitly
   in the module's `register()` function — see `editor.ts` `editor_screenshot`
   for the image path. Group tools with custom handlers go in `createHandler`
   in `src/groups.ts`.
5. Add a smoke-test round-trip assertion under the existing ones in
   `test/smoke.ts`, appended (never re-ordered — port-check must stay first).
6. Update tool counts and the toolkit-repo `CLAUDE.md` tool table.

## Error code reference (I1)

Canonical `ErrorCode` union lives in `src/types.ts` (single source of truth on
this side; mirrored as `MCP_ERROR_CODES` in the toolkit-repo `mcp_server.gd` +
`mcp_runtime_server.gd`). Adding a new code requires updating BOTH sides AND
this table. Codes are UPPER_SNAKE_CASE.

| Code               | Origin           | When                                                                          |
|--------------------|------------------|-------------------------------------------------------------------------------|
| `ALREADY_EXISTS`   | plugin           | `scene_create` / `resource_create` with `if_exists: "fail"` on collision. **Error payload only** post-iter-15 — idempotent collisions return success with `status: "returned"`. |
| `ALREADY_PLAYING`  | plugin (iter 15c)| `game_start` while `EditorInterface.is_playing_scene()` is true — call `game_stop` first. |
| `CLOSED`           | bridge           | Bridge call after `bridge.close()`.                                           |
| `CONNECT_FAILED`   | bridge           | WebSocket open failure (cold path; first attempt).                            |
| `CREATE_DIR_FAILED`| plugin (iter 15b)| `DirAccess.make_dir_recursive_absolute` returned non-OK on `folder_create`.   |
| `DELETE_FAILED`    | plugin (iter 15 / 15b) | `DirAccess.remove` non-OK from `scene_delete` / `script_delete` / `resource_delete` / `folder_delete`. |
| `DIR_NOT_EMPTY`    | plugin (iter 15b)| `folder_delete` with `recursive: false` on a non-empty directory.             |
| `DISCONNECTED`     | bridge           | Socket closed mid-call or no reconnect within `CALL_AWAIT_RECONNECT_MS`.      |
| `EDITED_SCENE`     | plugin (iter 15) | `scene_delete` against the currently-edited scene; open a different scene first. |
| `EXECUTE_FAILED`   | plugin (Mode B)  | `game.eval` Expression.execute returned an error.                             |
| `FEATURE_DISABLED` | both (iter 19+)  | Tool gated off by FeatureGate; reserved.                                      |
| `FILE_TOO_LARGE`   | plugin (iter 20) | Response cap exceeded; reserved.                                              |
| `FILESYSTEM_NOT_READY` | plugin (iter 15e) | `EditorFileSystem.is_scanning()` true when `asset_list` or `asset_get_dependencies` called. Agent should retry in 500-2000ms. |
| `FOLDER_PROTECTED` | plugin (iter 15b)| `folder_delete` targeting project root, `res://addons`, or the toolkit plugin dir. |
| `GAME_NOT_RUNNING` | bridge           | Mode B call when port 9090 isn't listening.                                   |
| `INTERNAL`         | both             | Catch-all for unexpected failure (viewport unavailable, save_png empty, …).   |
| `INVALID_CLASS`    | plugin           | Class resolution failure — unknown in both ClassDB + global class list / not instantiable / not a Node subclass (`scene_create_node` / `scene_create`) / not a Resource subclass (`resource_create`) / packed file is not a `PackedScene` (`scene_instantiate`) / script load failure for global class (`scene_create_node` iter 15h). |
| `INVALID_METHOD`   | plugin (iter 15c)| `node_call_method` target node exists but `has_method(method)` is false.     |
| `INVALID_PARAMS`   | plugin           | JSON-RPC params shape error (missing required field, wrong type).             |
| `INVALID_PATH`     | plugin           | Semantic refusal — edited-root on `scene_delete_node`, wrong prefix/extension on `scene_*` / `script_*` / `resource_*` / `folder_*`. Script tools now require `.gd`/`.cs`/`.gdshader`/`.gdshaderinc`. |
| `LOAD_FAILED`      | plugin           | `ResourceLoader.load` returned null.                                          |
| `LOG_UNAVAILABLE`  | plugin (iter 15e)| `editor_get_console` / `editor_get_errors` couldn't find a readable log under `user://logs/`. Check `application/config/use_file_logging`. |
| `NO_RUNTIME_URL`   | bridge           | `callRuntime` invoked when `createBridge` got no runtime URL.                 |
| `NO_SCENE`         | plugin           | `EditorInterface.get_edited_scene_root()` returned null.                      |
| `NOT_A_RESOURCE`   | plugin (iter 15b)| `resource_save` / `resource_delete` target loaded but isn't a Resource subclass. |
| `NOT_FOUND`        | plugin           | Node / scene file / resource / animation / connection / folder not found.     |
| `PACK_FAILED`      | plugin (iter 15) | `PackedScene.pack(root)` returned non-OK — only `scene_create` emits this.    |
| `PARENT_NOT_FOUND` | plugin (iter 15 / 15b) | `scene_create` / `resource_create` target's parent dir does not exist — use `folder_create` first (pre-FileGuard guard). |
| `PARSE_ERROR`      | plugin (Mode B)  | `game.eval` Expression.parse failed.                                          |
| `PATH_DENIED`      | plugin           | Path didn't pass the `res://` prefix check (full FileGuard in iter 18).       |
| `PATH_IN_USE`      | plugin (iter 15b)| `folder_delete` target contains the currently-edited scene or an open script tab. |
| `READ_FAILED`      | plugin           | `FileAccess` read error.                                                      |
| `RPC_ERROR`        | bridge           | Plugin returned a JSON-RPC envelope `error` field (transport-level).          |
| `SAVE_DELETE_FAILED` | plugin (iter 19c) | `DirAccess.remove_absolute` failed on a `user://` file via `save_delete`.   |
| `SAVE_FAILED`      | plugin           | `EditorInterface.save_scene` / `save_scene_as` / `ResourceSaver.save` failure. |
| `SAVE_READ_FAILED`  | plugin (iter 19c) | `FileAccess.open(READ)` failed on a whitelisted `user://` file.              |
| `SAVE_WRITE_FAILED` | plugin (iter 19c) | `FileAccess.open(WRITE)` failed on a whitelisted `user://` file.             |
| `SEND_FAILED`      | bridge           | WebSocket send callback errored.                                              |
| `TIMEOUT`          | bridge           | Per-call timer fired before response.                                         |
| `UNKNOWN_CLASS`    | plugin (iter 26)   | `classdb_get_info` class not found in ClassDB (engine classes) or global class list (user `class_name`). |
| `USER_PATH_NOT_WHITELISTED` | plugin (iter 19c) | `user://` path not in the plugin author's whitelist for the requested mode (read/write/delete). Message lists allowed entries. |
| `USER_SCOPE_DISABLED` | plugin (iter 19c) | `read_user_scope` feature gate is off or `user_scope_whitelist.json` is missing/malformed. |
| `WRITE_FAILED`     | plugin           | `FileAccess.open(WRITE)` failed.                                              |

## Pointers

- Execution plan (all 26 iterations, cross-repo): `<plan-repo>/Plan/ExecutionPlan/00-index.md`
- Companion plugin: `<toolkit-repo>/` — see its `CLAUDE.md` for tool usage.
- Distribution procedure: `<toolkit-repo>/DISTRIBUTION.md`.
