# CLAUDE.md — godot-mcp-server

Guidance for Claude Code (claude.ai/code) when **editing this repo's TypeScript
source**. If you are instead calling MCP tools from the plugin, see the toolkit
repo's `CLAUDE.md` (user-facing tool list + conventions).

---

## Contributor docs — read first

**Before changing the wire protocol, error handling, or tool contracts, read the
toolkit-owned contract doc
[`docs/dev/contract.md`](https://github.com/NPGameDev/godot-mcp-toolkit/blob/main/docs/dev/contract.md);
write all code per [`docs/dev/code-standards.md`](docs/dev/code-standards.md).**
Those are the authoritative SSOTs (the OSS comment canon is inlined into the code
standard). This `CLAUDE.md` is orientation + operational gotchas, not the contract.

Full dev-doc map, in read order:

1. [`docs/architecture/README.md`](docs/architecture/README.md) — how the server is built (bridge, registration, dispatch, groups).
2. [`docs/dev/code-standards.md`](docs/dev/code-standards.md) — TypeScript / Node + MCP-bridge conventions + hard gates (Portable core + Project bindings).
3. **Cross-repo contract** — toolkit [`docs/dev/contract.md`](https://github.com/NPGameDev/godot-mcp-toolkit/blob/main/docs/dev/contract.md) (toolkit-owned; this repo is the consumer).
4. [`docs/dev/glossary.md`](docs/dev/glossary.md) — server-owned terms; cross-links the toolkit glossary (the shared-vocabulary SSOT).
5. **Rationale trail** — commit history + [`docs/architecture/README.md`](docs/architecture/README.md). (This repo has no `docs/adr/`.)

User-facing doc surfaces (full index: [`docs/README.md`](docs/README.md); agent-facing
summary: [`llms.txt`](llms.txt)): [`docs/tool-reference/`](docs/tool-reference/README.md)
(generated via `npm run docs:tools` — never hand-edit),
[`docs/mcp-clients.md`](docs/mcp-clients.md) (client setup + permissions),
[`docs/testing-locally.md`](docs/testing-locally.md) (test workflow),
[`SECURITY.md`](SECURITY.md), and the toolkit-hosted
[troubleshooting page](https://github.com/NPGameDev/godot-mcp-toolkit/blob/main/docs/troubleshooting.md)
(one canonical page for both repos).

---

## What this repo is

The TypeScript MCP server that bridges Claude Code (stdio) to the `godot-mcp-toolkit`
Godot editor plugin (WebSocket `127.0.0.1:6550`). Repo root IS the npm package
root — no `server/` subdir wrapper. Distributed via `npm install -g @npgamedev/godot-mcp-server`
(or `npx -y @npgamedev/godot-mcp-server`).

## Architecture

- `src/index.ts` — entry. Resolves readOnly mode, constructs `McpServer` +
  `Bridge`, registers eager tools, connects `StdioServerTransport`.
- `src/transport/bridge.ts` — WebSocket client (lazy-connect, pending-map keyed by uuid,
  per-call timeout). Exposes `Bridge.call(method, params, timeoutMs)` and `close()`.
- `src/shared/types.ts` — `Bridge` interface, `ToolDef`, pure type/interface exports.
- `src/shared/errors.ts` — `BridgeError` runtime error class.
- `src/registration/toolRegistry.ts` — tool installation: `registerToolWrapped`/`registerTools`/
  `batchToolRegistration` + the wrapped-handler pre-flight (version gate, path guard,
  hook pipeline).
- `src/registration/toolDispatch.ts` — per-call dispatch: `callAndWrap` (bridge call + error-wrap +
  success-hint; uses `stableStringify` for deterministic output), `injectSuccessHint`.
- `src/shared/errorContract.ts` — `toolError*` builders, `EXCEPTION_HINTS`, crash-context errors.
- `src/shared/schemaCoercion.ts` — input coercion (`coercedBoolean`, `jsonCoerce`) + JSON-Schema→Zod.
- `src/security/profiles.ts` — tool visibility (`resolveAllowedTools`, `isReadOnly`,
  `isAllowedInReadOnly`, `isExcludedByReadOnly`). Defines `EAGER_TOOLS`.
- `src/groups/groups.ts` — lazy-load group system. `registerGroupSystem` registers
  `discover_tools` meta-tool. `GROUP_TOOL_NAMES` tracks group membership.
- `src/shared/stableJson.ts` — `stableStringify` (sorted-key JSON for deterministic,
  cache-friendly output).
- `src/tools/<group>.ts` — one file per logical group (`scene`, `node`, `script`,
  `editor`, `resource`, `folder`, `signals`, `diff`, `runtime`, `playtest`,
  `inputMap`, `animation`, `tilemap`, `asset`, `file`, `save`, `classdb`,
  `nodeManagement`).
  Each exports a typed `ToolDef[]` (with MCP annotations) and a
  `register(server, bridge, allowedTools)` function. Tools filter via the
  `allowedTools` Set.
- `test/smoke.ts` — harness. **Port-check first** (iter 05 contract) then round-trip
  assertions. Do NOT move the port-check below the assertions — it exits with
  instructions when the editor is down.

## Invariants for agents editing this repo

- **I1 — error contract.** Tools never throw past the bridge. Plugin-side errors
  come back as `{ success: false, error, code }` payloads; wrap them into MCP
  responses with `isError: true`. Use the helpers in `src/shared/types.ts`:
  `callAndWrap` for single-bridge-call handlers (default), `toolErrorFromException`
  + `toolErrorFromPayload` for custom handlers (screenshots).
  See **Error code reference** below for the canonical `ErrorCode` list.
- **I2 — description ≤ 200 chars.** Enforced by smoke. Tight descriptions help
  Claude Code pick the right tool.
- **I4 — path rule.** All `res://` path input eventually passes through
  `FileGuard.resolve_safe` (plugin side, iter 18). For now, callers leave
  `TODO(iter-18)` at each path-touching call site.
- **I6 — localhost-only.** Bridge URL is `ws://127.0.0.1:${GODOT_MCP_EDITOR_PORT}`.
  Never allow a non-loopback host.
- **I7 — one commit per iteration per repo.** Conventional-commit form:
  `feat(server): …`, `fix(server): …`, `refactor(server): …`.
- **I8 — rollback granularity.** `git revert <sha>` cleanly undoes one iteration's
  server-side work.

## Tool catalogue

Eager tools are always visible. Group tools are loaded on demand via
`discover_tools`. `GODOT_MCP_READ_ONLY=1` hides all tools without
`readOnlyHint: true` in their annotations (single source of truth).
Source of truth: each tool's `annotations.readOnlyHint`, filtered by
`isAllowedInReadOnly()` / `isExcludedByReadOnly()` in `src/security/profiles.ts`.

### Lazy-load groups

28 groups (78 tools) loaded via `discover_tools`. `node_manage`,
`node_groups`, `autoload_manage` were promoted to the eager set early, when
Claude Code did not yet process `tools/list_changed` notifications (current
versions do, in both interactive and pipe mode).

Source of truth: `src/groups/groups.ts` — see `GROUPS` array for full list.
Groups persist for the session.

When activating tool groups via `discover_tools`, always pass
`include_schemas: true` to receive full parameter schemas in the response.
This avoids a separate tool lookup for each activated tool.

## Idempotency — `status` + `if_exists` (pure passthrough)

The idempotency contract — the `status` discriminator (`created` / `returned` /
`replaced`), the `if_exists` modes (`return` / `fail` / `replace`), and which tools
are file-level vs node-level — is owned by the toolkit and specified as **contract
C6** in the toolkit's
[`docs/dev/contract.md`](https://github.com/NPGameDev/godot-mcp-toolkit/blob/main/docs/dev/contract.md).
The server is **pure passthrough (REFLECT)**: `if_exists` is a request param the LLM
sets and `status` is a response field the bridge forwards verbatim — the server adds
no idempotency logic of its own. Not restated here.

**When adding a server-side create tool** that needs collision handling, mirror that
shape: `if_exists` as `z.enum(["return","fail","replace"]).optional()` in the
`inputSchema` (toolkit-side default `"return"`), and let the `status` field pass
through untouched.

## Environment variables

The full env-var contract — which side consumes each var, and the cross-repo set
(`GODOT_MCP_EDITOR_PORT`, `GODOT_MCP_RUNTIME_PORT`, `GODOT_MCP_TOKEN_PATH`,
`GODOT_MCP_READ_ONLY`, `GODOT_MCP_LSP_PORT` / `GODOT_MCP_LSP_HOST`,
`GODOT_MCP_PROJECT_PATH`, `GODOT_MCP_CONFIG_VERSION`), plus the connect-side CLI
flags (`--editor-port` / `--runtime-port` / `--lsp-port` / `--lsp-host`) that
override the matching env var — is **contract C10** in the toolkit's
[`docs/dev/contract.md`](https://github.com/NPGameDev/godot-mcp-toolkit/blob/main/docs/dev/contract.md);
not restated here.

The server-side operational vars outside that cross-repo contract surface are the
response caps (`GODOT_MCP_SCRIPT_READ_LIMIT`, `GODOT_MCP_WS_BUFFER_LIMIT`) and
`GODOT_MCP_RATE_LIMIT` — the README's environment-variable table documents the
full live set.

## Version-aware tool catalog (iters 37, 41l-undecies)

The plugin sends its Godot version in the WebSocket auth handshake
(`{ "authed": true, "godot_version": "4.5.2" }`). The bridge also
pre-populates the version from the registry entry's `godot_version` field
(available before auth). The bridge exposes `Bridge.getGodotVersionString()`
(raw string) and `Bridge.getGodotVersion()` (returns `GodotVer` tuple
`[major, minor]` or `null`).

**Registration-time gating:** `src/registration/toolRegistry.ts` checks each tool's
`godotMinVersion` / `godotMaxVersion` (string, `"major.minor"` format)
against the connected Godot version at tool registration time. Incompatible
tools are silently skipped — they never appear in `tools/list`. A runtime
defence-in-depth check remains in the wrapped handler for reconnect scenarios.

The toolkit side mirrors this: `command_registry.gd` checks version bounds
in `add()` and blocks incompatible commands before registration.

Currently only `scene_close` has `godotMinVersion: "4.5"` (requires 4.5+).
To version-gate a new tool, add `godotMinVersion: "X.Y"` and/or
`godotMaxVersion: "X.Y"` to its `ToolDef`.

## Linting & formatting

Write all TypeScript per [`docs/dev/code-standards.md`](docs/dev/code-standards.md)
— the authoritative standard (TS/Node + MCP-bridge conventions, hard gates, async
discipline, and the inlined OSS comment canon). The tooling below enforces only the
mechanical sliver.

- **ESLint** — `eslint.config.js` (flat config, typescript-eslint recommended +
  eslint-config-prettier). `npm run lint` checks `src/` and `test/`.
- **Prettier** — `.prettierrc` (2-space, double quotes, semicolons, trailing
  commas, 120-char printWidth). `npm run format` checks all files;
  `npm run format:fix` auto-fixes.
- **`.editorconfig`** — 2-space indent for `.ts`/`.js`/`.json`, UTF-8, LF.

Run `npm run lint && npm run format` before committing.

## CI/CD (GitHub Actions)

- **CI** (`.github/workflows/ci.yml`) — floor gates, run on push/PR to main (with
  `concurrency` cancel-in-progress). Node 22+24 matrix
  (`npm ci`/`build`/`test:unit`/`lint`/`format`/`smoke:ci`) + an editor-free C#
  SDK-compile floor (3 TFM-boundary rows: 4.2/net6, 4.4/net8, 4.7/net8). An
  aggregate **`Server floor OK`** gate `needs:` both matrices — it is the only name
  that ever becomes a required check (never an individual matrix row).
- **cross-version** (`.github/workflows/cross-version.yml`) — the opt-in deep tier:
  the full two-editor behavioral matrix (GDScript + .NET/mono, 4.2–4.7) against the
  pinned toolkit sibling, plus a dispatch-integration leg on one row. Fires on
  `[run-cross-version-ci]`, `workflow_dispatch`, or a release (via `workflow_call`).
- **Release** (`.github/workflows/release.yml`) — runs on `v*` tag push; GATES on
  the deep behavioral tier (`behavioral: uses: cross-version.yml` + `needs:`), then
  validates tag matches `package.json` version, runs the package-shape gate
  (`npm pack` + publint + generated-docs freshness), builds, publishes to npm
  (`NPM_TOKEN` secret; OIDC is a 42b TODO), and creates a GitHub Release.
  `workflow_dispatch` runs the whole chain as a **dry-run** (publish skipped).

## Accuracy eval suite (iter 40)

Separate from smoke (smoke = "does it work", eval = "does it work well").
Runs against a live Godot instance like smoke but tests two dimensions:

- **Correctness** (scenarios 01–05): scripted workflows with known expected
  outcomes — scene creation, ClassDB accuracy, script validation, error
  recovery hints, read/write round-trips. Expected: 100% pass rate.
- **Efficiency** (scenario 06): multi-step workflows measuring tool-call
  count vs known-optimal sequences — player character creation (7 calls),
  physics-body configuration (3 calls), script debugging (4 calls).

```
npm run eval         # runs all 6 scenarios, prints report with baseline metrics
```

The eval harness lives in `test/eval/`:
- `eval-runner.ts` — discovers + runs scenarios, collects results
- `eval-report.ts` — report generator (pass/fail, tool calls, efficiency %)
- `scenarios/01-*.ts` through `scenarios/06-*.ts` — self-contained scenarios

Eval does NOT replace smoke. Smoke validates registration + basic round-trips;
eval validates real-world workflow quality. Both are needed.

## Workflow

```
npm install          # once
npm run build        # tsc -> dist/, postbuild adds shebang
npm run lint         # ESLint check
npm run format       # Prettier check (format:fix to auto-fix)
npm run eval         # accuracy eval (correctness + efficiency, editor must be up)
npm run smoke        # full smoke suite (editor must be up)
npm run smoke:single # single-pass (inherits env vars from caller)
npm run smoke:ci     # static catalogue validation only (no Godot required)
npm link             # dogfood: global `godot-mcp-server` resolves to this dist/
```

**Editor UAF (engine bug, root-caused — smoke no longer arms it):** setting
`editor_description` on a node then deleting it within ~0.5 s triggers a
use-after-free in the editor's `SceneTreeEditor` tooltip timer (Godot 4.3+, not
ours; `Insights/smoke-backpressure-crash-characterization.md` +
`EngineBugs/scene-tree-tooltip-timer-uaf/`). Section 02 did this and SIGSEGV'd
the editor on full-run-then-`--only 2`; it now round-trips on the never-deleted
scene root, so the suite is deterministically safe (6/6 on the former killer).
When adding a test, never set `editor_description` on a node you then delete —
target the scene root. Belt-and-suspenders: a run dying with `WebSocket closed
before response` + a dead editor = this flake → relaunch and re-run.

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
3. Decide placement: add the tool's name to `EAGER_TOOLS` (always visible),
   or to a group's `tools` array in `src/groups/groups.ts` (lazy-loaded via
   `discover_tools`).
4. If the tool returns non-text content (images, binary), handle it explicitly
   in the module's `register()` function — see `runtime.ts` `runtime_screenshot`
   for the image path. Group tools with custom handlers go in `createGroupToolHandler`
   in `src/groups/groupToolHandlers.ts`.
5. Add a smoke-test section in `test/sections/` following the section naming
   convention, then import and register it in `test/smoke.ts`.
6. Update tool counts and the toolkit-repo `CLAUDE.md` tool table.

## Error code reference (I1)

This table is the **operational SSOT** for the human-readable error-code list — it is
deliberately **not** duplicated in the contract doc, whose **C4** describes the
error-code *wire framing* + stability tier and points to source for the full
enumeration. C4 is the contract; this table is the lookup — keep them consistent.

Canonical `ErrorCode` union lives in `src/shared/types.ts` (single source of truth on
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
| `EDITED_SCENE`     | plugin (iter 15) | `scene_delete` / `file_delete` against the active scene on 4.2-4.4 (no tab-close API). On 4.5+ the tab is auto-closed first. |
| `EXECUTE_FAILED`   | plugin (Mode B)  | `game.eval` Expression.execute returned an error.                             |
| `FILE_TOO_LARGE`   | plugin (iter 20) | Response cap exceeded; reserved.                                              |
| `FILESYSTEM_NOT_READY` | plugin (iter 15e) | `EditorFileSystem.is_scanning()` true when `asset_list` or `asset_get_dependencies` called. Agent should retry in 500-2000ms. |
| `FOLDER_PROTECTED` | plugin (iter 15b)| `folder_delete` targeting project root, `res://addons`, or the toolkit plugin dir. |
| `GAME_NOT_RUNNING` | bridge           | Mode B call when runtime port isn't listening.                                |
| `INTERNAL`         | both             | Catch-all for unexpected failure (viewport unavailable, save_png empty, …).   |
| `INVALID_CLASS`    | plugin           | Class resolution failure — unknown in both ClassDB + global class list / not instantiable / not a Node subclass (`scene_create_node` / `scene_create`) / not a Resource subclass (`resource_create`) / packed file is not a `PackedScene` (`scene_instantiate`) / script load failure for global class (`scene_create_node` iter 15h). |
| `INVALID_METHOD`   | plugin (iter 15c)| `node_call_method` target node exists but `has_method(method)` is false.     |
| `INVALID_PARAMS`   | plugin           | JSON-RPC params shape error (missing required field, wrong type).             |
| `INVALID_PATH`     | plugin           | Semantic refusal — edited-root on `scene_delete_node`, wrong prefix/extension on `scene_*` / `script_*` / `resource_*` / `folder_*`. Script tools now require `.gd`/`.cs`/`.gdshader`/`.gdshaderinc`. |
| `LOAD_FAILED`      | plugin           | `ResourceLoader.load` returned null.                                          |
| `LOG_UNAVAILABLE`  | plugin (iter 15e)| `editor_get_console` couldn't find a readable log under `user://logs/`. Check `application/config/use_file_logging`. |
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
| `UNSUPPORTED`      | both (iter 37)   | Tool requires a newer Godot version than connected. Server checks `godotMinVersion`; plugin checks `has_method()`. |
| `UNKNOWN_CLASS`    | plugin (iter 26)   | `classdb_get_info` class not found in ClassDB (engine classes) or global class list (user `class_name`). |
| `WRITE_FAILED`     | plugin           | `FileAccess.open(WRITE)` failed.                                              |

## Version sync policy

Both repos (toolkit + server) share a single semver. The version lives in:
- **Server:** `package.json` → `"version"`
- **Toolkit:** `addons/godot_mcp_toolkit/plugin.cfg` → `version=`

`scripts/get-version.sh` extracts the declared version (CI uses this to
validate sync). Future version bumps change both files and tag both repos
with the same `vX.Y.Z` tag.

## Dependency pinning policy

All npm dependencies use **exact** versions (no `^` or `~` prefixes).
This ensures reproducible installs — two different `npm install` runs
produce identical `node_modules/`. Dependency updates are deliberate PRs,
not silent drift from caret ranges.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for dev environment setup, testing
workflow, dependency policy, and PR guidelines.

## Pointers

- Execution plan (all iterations, cross-repo): `<plan-repo>/Plan/ExecutionPlan/00-index.md`
- Companion plugin: `<toolkit-repo>/` — see its `CLAUDE.md` for tool usage.
- Distribution procedure: `<toolkit-repo>/DISTRIBUTION.md`.
