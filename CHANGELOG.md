# Changelog

All notable changes to the Godot MCP Server are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing has been released yet; every change below ships in the first tagged
release.

### Breaking Changes

These are pre-1.0 clean breaks with no aliases or deprecation shims. Update any
`.mcp.json`, shell environment, or scripts that use the old names.

- Renamed the editor-port environment variable `GODOT_MCP_PORT` to
  `GODOT_MCP_EDITOR_PORT`, so all three channels (editor, runtime, LSP) now use a
  consistent `GODOT_MCP_*_PORT` scheme.
- Changed the default ports: the editor channel now uses `6550` (was `6505`) and
  the runtime channel uses `6570` (was `6525`).
- Canonicalized tool parameter names in a single pass so every tool uses one
  clear name for the same idea (for example, folder tools now take `path`, not
  `folder_path`; `project_set_setting` takes `setting`, not `key`; `input_map`
  takes `name`, not `action_name`). There are no aliases for the old names.
- Removed the profile system. The `GODOT_MCP_PROFILE` environment variable is no
  longer read, the no-op `--lite` flag is gone, and there is no custom-tool list
  (`GODOT_MCP_CUSTOM_TOOLS`). Set `GODOT_MCP_READ_ONLY=1` for a read-only tool
  surface; the full tool surface is otherwise always available and expands
  on demand.
- Removed the feature-gate system, including the `GODOT_MCP_ALLOW_*` environment
  variables. Tools are no longer gated behind allow flags.
- Removed the `enable_tool_group` tool. Use `discover_tools` to find and activate
  the tool group you need.

### Added

- Language-server tools backed by each project's GDScript language server:
  diagnostics, document symbols, go-to-definition, find-references, hover, and
  completion, plus a project-wide `lsp_project_diagnostics` error scan. LSP ports
  are discovered per project, and a port collision is reported instead of silently
  reaching the wrong editor.
- A debugger tool group: set and clear breakpoints, step through code, and inspect
  debug state.
- A `discover_tools` meta-tool that finds and activates on-demand tool groups by
  keyword. It reports honestly when a group is already loaded, returns each newly
  available tool's schema in the activation response, and matches on keywords
  rather than exact names.
- On-demand extension tools: tools registered by third-party addons appear and
  disappear live as extensions are loaded, reloaded, or removed, with an
  `extensions_refresh` tool to resync on demand.
- New tool groups mirroring the toolkit's expanded command surface: TileSet
  authoring, theme editing, AnimationTree editing, project layer-name management,
  3D scene helpers, Path2D curve editing, collision-shape generation from a
  texture, inherited-scene creation, audio-bus editing, SpriteFrames editing, GPU
  particle systems, navigation, and a filtered `scene_query`.
- `execute_code`, which runs a snippet in the editor or in the running game
  (selected by `context`, defaulting to the running game).
- `scene_spatial_map`, reporting node positions and bounds, plus
  `texture_generate` and `sound_generate` for placeholder assets, and
  `script_edit` for targeted edits to a script instead of whole-file rewrites.
- A `send_text` event on `input_simulate` for typing into a focused text field,
  and support for passing a single input event instead of only an array.
- CLI flags `--editor-port`, `--runtime-port`, `--lsp-port`, `--lsp-host`, and
  `--help`, resolved with the precedence CLI flag > environment variable >
  registry discovery > default. `--tools-count` and `--list-eager` print the tool
  surface (counts and the eager tool list) and exit without needing an editor.
- A generated tool-reference document (`docs/tool-reference/`) covering every
  built-in tool and its operations, kept in sync with the catalogue by the
  `docs:tools` script.
- Startup diagnostics: each channel logs its resolved port and where the value
  came from (CLI, environment, discovery, or default), and pinned ports are
  validated as integers in range so an invalid value exits with a precise error
  instead of crashing at first connection.
- A fail-fast desync check: a pinned editor port that cannot connect, or whose
  handshake fails because another server occupies it, now reports exactly which
  port is wrong instead of hanging on a dead socket.
- A version handshake between the server and the plugin, reporting a clear
  incompatibility message when the two are out of sync.
- Client-side cancellation of in-flight tool calls.
- `runtime_poll` on `game_start` to re-probe the running game's connection
  without restarting it, and `wait_for_runtime` so a single `game_start` call
  waits for the game to be ready and reports the precise stage and hint if it is
  not.
- `scene_close` reports whether it discarded unsaved changes, and gains a
  destructive marker in its tool metadata.
- A `root_name` input parameter on `scene_create`.
- Next-step `successHint` suggestions on many tools, and per-tool path validation
  that reports a clear `PATH_DENIED` error for a path outside the project.
- A clear error at startup when the Node.js version is below the supported
  minimum.

### Changed

- Renamed `game_eval` to `execute_code` and `editor_reload_scripts` to
  `editor_refresh`.
- Screenshot tools take an `image_detail` option (replacing `size`) to choose
  between an inline downscaled image and a save-to-disk path, and clearly report
  when a viewport cannot be captured instead of returning a blank image.
- `game_start` waits for the running game to actually be ready in a single call
  and reports the precise failure stage and a recovery hint when it is not.
- Real pagination (offset, limit, and total) on class-browsing, script and save
  reads, and scene queries, with configurable size caps.
- Read-only visibility is derived from each tool's own annotations, so
  `GODOT_MCP_READ_ONLY=1` consistently hides every mutating tool.
- The eager tool set was re-tiered as tools landed, so the most commonly needed
  tools (including runtime screenshot, input, and log tools, and node and group
  management) are available immediately on connect.
- Schemas were tightened across several tools: `wait_for_runtime` defaults to
  true, animation `track_type` is a fixed enum, and node-group inputs are stricter.
- Raised the minimum supported Godot version ceiling to 4.7.
- Simplified the macOS setup guidance: the standard `npx` invocation works with
  modern clients, and fallbacks are documented only where they are actually needed.
- Error hints no longer mention retired concepts (feature gates, profiles, or
  documentation that does not ship).

### Fixed

- A startup race that could omit extension or version-gated tools from the first
  tool list, and a double-registration crash that could occur when the client
  reconnected.
- `.gdshader` files are no longer mis-parsed as GDScript by the language tools.
- Windows LSP paths are returned as `res://` paths rather than leaking a raw
  filesystem path.
- Optional parameters that take a JSON-encoded string are no longer advertised as
  required.
- A false "the toolkit did not report its version" warning that could appear when
  launching the game.
- Crash-context and error reporting: the correct error code and richer hints are
  returned, log reads distinguish a transient lock from a missing log and fall
  back to the debug log, and `LOG_BUSY` and `LOG_UNAVAILABLE` hints point at the
  real cause. Console and log tools gain `source`, `text_filter`, and `is_regex`
  options.
- `debug_set_breakpoint` handles its `enabled` and `line` parameters correctly.
- Many tool descriptions and schemas were corrected to match actual behavior.

### Removed

- The placeholder security gates (`os_execute`, `outbound_http`) and the
  never-enforced user-scope allowlist.

## Prior history

Before this changelog adopted the Keep a Changelog format, entries were derived
from the commit history. The full pre-release development history is available in
the Git log.
