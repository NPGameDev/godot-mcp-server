# Godot MCP Server

[![CI](https://github.com/NPGameDev/godot-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/NPGameDev/godot-mcp-server/actions/workflows/ci.yml)
![version](https://img.shields.io/badge/version-1.0.0-blue)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

[MCP](https://modelcontextprotocol.io) server that connects AI coding assistants to the Godot 4.x editor. 61 tools for scene manipulation, script editing, resource management, playtesting, and more.

## What it does

This Node.js process bridges your AI coding assistant to a running Godot editor. It speaks MCP over stdio to the assistant and forwards tool calls over a localhost WebSocket to the companion [Godot MCP Toolkit](https://github.com/NPGameDev/godot-mcp-toolkit) plugin.

Tested primarily with [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Compatible with any MCP client that supports the Model Context Protocol.

## Quick start

### 1. Install

```bash
npm install -g @npgamedev/godot-mcp-server
```

Or run directly with npx (no global install):

```bash
npx -y @npgamedev/godot-mcp-server
```

Requires Node.js 20+.

### 2. Install the Godot plugin

This server requires the companion [Godot MCP Toolkit](https://github.com/NPGameDev/godot-mcp-toolkit) plugin running in the Godot editor. Install it via AssetLib or GitHub Releases, then enable it in Project Settings &rarr; Plugins.

### 3. Configure your MCP client

In your Godot project root, create `.mcp.json`:

```json
{
  "mcpServers": {
    "godot-mcp-toolkit": {
      "command": "npx",
      "args": ["-y", "@npgamedev/godot-mcp-server"]
    }
  }
}
```

<details>
<summary>Windows: use the cmd wrapper</summary>

```json
{
  "mcpServers": {
    "godot-mcp-toolkit": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "@npgamedev/godot-mcp-server"]
    }
  }
}
```

</details>

### 4. Connect

Launch your MCP client from the project root. The server discovers the plugin automatically via a shared project registry and authenticates with a per-session token.

## Configuration

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GODOT_MCP_PORT` | auto | Override the editor WebSocket port (default: auto-discovered from project registry) |
| `GODOT_MCP_RUNTIME_PORT` | `6525` | Override the game runtime WebSocket port |
| `GODOT_MCP_PROJECT_PATH` | `cwd` | Absolute path to the Godot project |
| `GODOT_MCP_PROJECT_NAME` | from `project.godot` | Project name for token resolution |
| `GODOT_MCP_TOKEN_PATH` | platform-specific | Override the auth token file path |
| `GODOT_MCP_PROFILE` | `standard` | Profile: `minimal`, `standard`, `full`, or `custom` |
| `GODOT_MCP_CUSTOM_TOOLS` | — | Comma-separated tool names (with `custom` profile) |
| `GODOT_MCP_READ_ONLY` | `0` | Set to `1` to remove all mutating tools from any profile |
| `GODOT_MCP_RATE_LIMIT` | `0` | Max tool calls per second (`0` = unlimited) |

### Feature gate variables

These enable individually gated capabilities. Most require opt-in on **both** the server (env var) and the plugin (Project Settings).

| Variable | Gate | Enables |
|----------|------|---------|
| `GODOT_MCP_ALLOW_GAME_EVAL` | dual | `game_eval` — arbitrary GDScript via Expression |
| `GODOT_MCP_ALLOW_USER_SCOPE` | dual | `save_*` tools — read/write whitelisted `user://` paths |
| `GODOT_MCP_ALLOW_NODE_CALL_METHOD` | single | `node_call_method` — call methods on editor nodes |
| `GODOT_MCP_ALLOW_PROJECT_SET_SETTING` | dual | `project_set_setting` — write ProjectSettings keys |
| `GODOT_MCP_ALLOW_INPUT_MAP_WRITE` | single | `input_map_*` tools — modify InputMap actions |

**Dual-gate** = both env var and plugin ProjectSetting must be enabled. **Single-gate** = either side enables it.

## Profiles

Control which tools your AI assistant sees. See [Token Efficiency](docs/token-efficiency.md) for per-profile token cost data.

| Profile | Tools | Catalogue tokens | Best for |
|---------|-------|-----------------|----------|
| **minimal** | 13 | ~1,300 | Read-only exploration. Scene inspection, script reading, class lookups. |
| **standard** | 39 | ~3,700 | Day-to-day development. Scene/script/resource editing plus on-demand group access. |
| **Power User** | 60 | ~5,800 | Full access including feature-gated tools. Risk warning on activation. |
| **custom** | user-defined | varies | Cherry-pick tools via `GODOT_MCP_CUSTOM_TOOLS`. |

```bash
# Via environment variable
GODOT_MCP_PROFILE=minimal npx @npgamedev/godot-mcp-server

# In .mcp.json
"env": { "GODOT_MCP_PROFILE": "full" }
```

### On-demand tool groups (standard profile)

The standard profile includes an `enable_tool_group` meta-tool that lets the AI assistant unlock additional capabilities during a session without switching profiles:

| Group | Tools | What it unlocks |
|-------|-------|-----------------|
| `runtime` | 5 | Runtime screenshots, live node inspection, game log, input simulation, animation control |
| `signals` | 3 | Signal connect/disconnect, emit |
| `animation_authoring` | 2 | Keyframe editing, key inspection |
| `input_map` | 2 | InputMap action/event management (feature-gated) |
| `asset_management` | 6 | Asset import, resource/scene/file deletion, scene close |
| `user_data` | 4 | `user://` file read/write/delete/list (feature-gated) |

## Tool reference

<details>
<summary><strong>Scene tools</strong> (9)</summary>

| Tool | Description |
|------|-------------|
| `scene_get_tree` | Return the edited scene's node tree as nested JSON |
| `scene_create_node` | Create a node under a parent (engine or custom classes) |
| `scene_delete_node` | Delete a node by path (refuses scene root) |
| `scene_create` | Create a `.tscn` file with a typed root node |
| `scene_delete` | Delete a `.tscn` and its `.uid` companion |
| `scene_instantiate` | Instantiate a PackedScene under a parent |
| `scene_open` | Open a scene as the active edited tab |
| `scene_close` | Close an open scene tab |
| `scene_diff` | Compare scene-tree snapshots for changes |

</details>

<details>
<summary><strong>Node tools</strong> (5)</summary>

| Tool | Description |
|------|-------------|
| `node_get_property` | Read a property from a node |
| `node_set_property` | Set a property on a node |
| `node_get_property_list` | List inspector-visible properties |
| `node_set_script` | Attach a script to a node |
| `node_call_method` | Call a method on a node (feature-gated) |

</details>

<details>
<summary><strong>Script tools</strong> (5)</summary>

| Tool | Description |
|------|-------------|
| `script_read` | Read a GDScript file |
| `script_write` | Write a `.gd` / `.cs` / `.gdshader` file |
| `script_read_range` | Read a specific line range from a script |
| `script_delete` | Delete a script file and its `.uid` companion |
| `script_check` | Validate GDScript — structured diagnostics with line numbers |

</details>

<details>
<summary><strong>Editor tools</strong> (7)</summary>

| Tool | Description |
|------|-------------|
| `editor_save_scene` | Save (or save-as) the current scene |
| `editor_reload_scripts` | Rescan `res://` and reload scripts |
| `editor_get_console` | Tail the editor Output panel |
| `editor_wait_for_idle` | Wait for EditorFileSystem scan to complete |
| `project_get_settings` | List ProjectSettings (optional prefix filter) |
| `project_set_setting` | Write a ProjectSettings key (feature-gated) |

</details>

<details>
<summary><strong>Resource tools</strong> (3)</summary>

| Tool | Description |
|------|-------------|
| `resource_load` | Load a resource — class, path, properties, metadata |
| `resource_write` | Write/create a `.tres` / `.res` resource |
| `resource_delete` | Delete a resource and its `.uid` companion |

</details>

<details>
<summary><strong>Folder & file tools</strong> (3)</summary>

| Tool | Description |
|------|-------------|
| `folder_create` | Create a directory (recursive, idempotent) |
| `folder_delete` | Delete a directory (optional recursive) |
| `file_delete` | Delete any file under `res://` with `.import` cleanup |

</details>

<details>
<summary><strong>Asset tools</strong> (3)</summary>

| Tool | Description |
|------|-------------|
| `asset_list` | Enumerate `res://` assets with filters (path, name, class, extension) |
| `asset_get_dependencies` | Get forward dependencies of a resource or scene |
| `asset_import` | Import binary assets (image/audio/font/3D) via file path or base64 |

</details>

<details>
<summary><strong>Playtest tools</strong> (2)</summary>

| Tool | Description |
|------|-------------|
| `game_start` | Start a playtest; optionally wait for runtime connection |
| `game_stop` | Stop the running game (idempotent) |

</details>

<details>
<summary><strong>Runtime tools</strong> (7)</summary>

| Tool | Description |
|------|-------------|
| `runtime_screenshot` | Capture a frame from the running game |
| `runtime_get_node_state` | Inspect a live node in the running game |
| `runtime_get_script_vars` | Get script variables for a live game node |
| `debugger_get_log` | Read recent game log lines |
| `input_simulate` | Inject input events into the running game |
| `animation_player_control` | Drive an AnimationPlayer at runtime |
| `game_eval` | Evaluate GDScript via Expression (feature-gated) |

</details>

<details>
<summary><strong>Signal tools</strong> (3)</summary>

| Tool | Description |
|------|-------------|
| `signal_list` | List signals on a node |
| `signal_manage` | Connect or disconnect signals |
| `signal_emit` | Emit a signal (editor or runtime mode) |

</details>

<details>
<summary><strong>Animation authoring tools</strong> (2)</summary>

| Tool | Description |
|------|-------------|
| `animation_keyframe` | Add or remove a keyframe on a track |
| `animation_get_keys` | List keys on an AnimationPlayer track |

</details>

<details>
<summary><strong>Input map tools</strong> (2, feature-gated)</summary>

| Tool | Description |
|------|-------------|
| `input_map_action` | Add or remove an InputMap action |
| `input_map_event` | Bind or unbind input events to actions |

</details>

<details>
<summary><strong>User data tools</strong> (4, feature-gated)</summary>

| Tool | Description |
|------|-------------|
| `save_read` | Read a whitelisted `user://` file |
| `save_write` | Write to a whitelisted `user://` file |
| `save_delete` | Delete a whitelisted `user://` file |
| `save_list` | List files in a whitelisted `user://` directory |

</details>

<details>
<summary><strong>ClassDB tools</strong> (2)</summary>

| Tool | Description |
|------|-------------|
| `classdb_get_info` | Inspect any Godot class — properties, methods, signals, constants, inheritance |
| `classdb_search` | Find classes by inheritance chain or name pattern |

</details>

## Headless mode

When Godot runs with `--headless --editor`, the plugin loads and 51 of 53 tools work normally — including scene tree operations, node manipulation, and signal management (not just file I/O). Only screenshot tools (`editor_screenshot`, `runtime_screenshot`) require a display and return `HEADLESS_UNSUPPORTED`. Verified across Godot 4.2 through 4.6 on Windows. See the [plugin COMPATIBILITY.md](https://github.com/NPGameDev/godot-mcp-toolkit/blob/main/COMPATIBILITY.md#headless-mode---headless) for the full per-tool matrix.

## Token efficiency

Each profile consumes a fixed amount of context window for the MCP tool catalogue. Schema minification (enabled by default) reduces this by ~19%.

| Profile | Catalogue cost |
|---------|---------------|
| Minimal | ~1,300 tokens |
| Standard | ~3,600 tokens (+ ~200–600 per on-demand group) |
| Power User | ~5,700 tokens |

Run `npx tsx scripts/measure-tokens.ts` to regenerate measurements after adding or modifying tools. See [docs/token-efficiency.md](docs/token-efficiency.md) for the full per-tool breakdown, group costs, and methodology.

## Accuracy eval

An accuracy eval suite (`npm run eval`) tests two dimensions against a live Godot instance:

- **Correctness** (5 scenarios, 58 assertions): scene creation workflows, ClassDB accuracy, script validation, error recovery hints, read/write round-trips. Baseline: 100% pass rate.
- **Efficiency** (3 workflows, 18 assertions): player character creation (7 calls), physics-body configuration (3 calls), script debugging (4 calls). Baseline: 100% optimal — 14 tool calls across all workflows match known-optimal sequences.

The eval suite is separate from the smoke test. Smoke validates "does it work" (255 assertions); eval validates "does it work well" (76 assertions). Run `npm run eval` to establish or verify the baseline.

## Known limitations

### `claude -p` does not support dynamic tool loading

**Affected:** Standard profile's `enable_tool_group` lazy-loading (Claude Code 2.1.104, confirmed 2026-05-06).

`claude -p` (pipe mode) does not process `tools/list_changed` MCP notifications. The server sends the notification after `enable_tool_group` registers new tools, but the pipe-mode client does not re-fetch the tool list. Dynamically loaded tools are unreachable.

**Workaround:** Set `GODOT_MCP_PROFILE=full` in `.mcp.json` for `claude -p` workflows. This eagerly loads all tools at startup. Interactive `claude` sessions handle dynamic loading correctly.

## Security

The toolkit implements defense-in-depth security. See the [plugin README](https://github.com/NPGameDev/godot-mcp-toolkit#security) for full details.

- **Session auth** — random 64-char hex token per plugin start; unauthorized connections rejected
- **Filesystem sandbox** — `res://` only by default; path traversal and symlink escapes blocked
- **Feature gates** — dangerous tools require dual opt-in (env var + project setting)
- **Audit log** — every tool call logged with timestamp and parameter hash
- **Response caps** — size-limited reads prevent accidental data exfiltration
- **Untrusted envelopes** — per-call nonce-tagged wrappers mitigate prompt injection
- **Localhost only** — `127.0.0.1` bind; never `0.0.0.0`

> **Disclaimer:** We take security seriously and design every layer with defense-in-depth, but no software is immune to misuse or unforeseen vulnerabilities. This project is provided under the [MIT License](LICENSE) with no warranty. You are responsible for evaluating whether it meets your security requirements before use.

## Architecture

```
┌─────────────┐          ┌─────────────────────┐          ┌────────────────────┐
│  MCP client │─ stdio ─>│  godot-mcp-server   │─ ws ────>│  godot-mcp-toolkit │
│  (AI agent) │          │  (this package)     │  :6505   │  (Godot plugin)    │
└─────────────┘          └─────────┬───────────┘          └─────────┬──────────┘
                                   │                                │
                                   └──── ws :6525 (Mode B) ────────>│
                                         (playtest runtime)        (autoload)
```

- **Mode A** (editor, default port 6505) — operates on the edited scene via `EditorInterface`.
- **Mode B** (runtime, default port 6525) — operates on the live `SceneTree` during playtests. Auto-connected when `game_start` runs with `wait_for_runtime: true`.

Port discovery is automatic via a shared project registry; `GODOT_MCP_PORT` overrides if needed. Auth tokens are resolved per-project (and per-worktree for multi-instance setups).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE). Upstream notices in [ATTRIBUTIONS.md](ATTRIBUTIONS.md).
