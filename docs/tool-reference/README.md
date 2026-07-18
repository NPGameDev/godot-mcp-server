---
title: Tool Reference
permalink: /tool-reference/
nav_order: 3
---

# Godot MCP Server — Tool Reference

Generated from the tool catalogue (`src/registration/catalogue.ts`) — regenerate with `npm run docs:tools`. This is the per-tool **reference**; for the subsystem **explanation** see [Architecture](../architecture/README.md).

**112 built-in tools** exposing **160 operations** — an action-consolidated tool packs several operations behind one discriminator, so the operation count runs ahead of the tool count. Counts are a ceiling ("up to"); some tools and operations are Godot-version-gated and absent on older editors.

## Startup surface (eager)

Registered up front — always in the initial `tools/list`. The two meta tools (`discover_tools`, `extensions_refresh`) are also eager but defined outside the catalogue.

_34 tools, 48 operations._

<!-- tool:editor_save_scene -->
### `editor_save_scene`

Save the current edited scene. Optional file_path triggers save-as.

**eager** · idempotent

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `file_path` | string | no |  |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:scene_open -->
### `scene_open`

Open a scene (.tscn / .scn) as the active edited scene. res:// only; NOT_FOUND if the file doesn't exist.

**eager** · read-only

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `file_path` | string | yes |  |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:project_get_settings -->
### `project_get_settings`

List ProjectSettings keys + values. Optional prefix filter. Keys matching /password|token|secret|key/i are dropped (MVP filter).

**eager** · read-only

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `prefix` | string | no |  |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:editor_get_console -->
### `editor_get_console`

Tail editor Output. source='buffer' (default): live editor console on 4.5+, game-log tail on 4.2-4.4. source='file': the game-written log (never editor output, any version). level_filter, since_id, text_filter (is_regex=true for regex). Carries returned/total_lines/has_more + next_id — page via since_id. Primary post-crash diagnostic tool — reads runtime errors even after game_stop.

**eager** · read-only

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `clear_buffer` | boolean | no | Clear the log buffer before reading. Use when stale errors persist after successful script recompilation. |
| `is_regex` | boolean | no | Treat text_filter as a regex pattern instead of a plain substring (default false). |
| `level_filter` | union | no | Single level or array of levels to filter by |
| `limit` | number | no |  |
| `since_id` | number | no |  |
| `source` | enum | no |  |
| `text_filter` | string | no | Substring to match against message text (case-insensitive). Set is_regex=true for regex patterns. |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:project_set_setting -->
### `project_set_setting`

Write a ProjectSettings key and persist via ProjectSettings.save. Refuses mcp_toolkit/*, mcp/*, and editor/* prefixes. Returns previous_value. Update (no status).

**eager**

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `setting` | string | yes | ProjectSettings key (e.g. 'application/config/name') |
| `value` | any | yes |  |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:folder_create -->
### `folder_create`

Create directory at res:// path (recursive — parents auto-created). Idempotent: status created on fresh, returned if pre-existing.

**eager** · idempotent

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | string | yes |  |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:node_get_property -->
### `node_get_property`

Read a property from the node at path. Returns { value } (engine types are dict-wrapped).

**eager** · read-only

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `node_path` | string | yes |  |
| `property` | string | yes | Property name. Use ':' to chain into sub-resources (e.g. 'material:shader_parameter/value'). |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:node_set_property -->
### `node_set_property`

Set a property on a node in the EDITOR scene tree (saved to .tscn files). Does NOT affect the running game — for runtime property changes during playtesting, use runtime_set_property.  Node paths are relative to the edited scene root: "." is root, "./Player" is a direct child, "./Player/Sprite2D" for deeper nodes.  Engine types: {type:'Vector2',x,y}. Inline sub-resources: {type:'NewResource',class:'CircleShape2D',properties:{radius:50}}. External resources (textures, audio, tilesets, materials): {type:'Resource', path:'res://path/to/file.tres'}. Packed arrays: {type:'PackedVector2Array', values:[{type:'Vector2',x:0,y:0}, ...]}. Collision layers: {type:'LayerMask', layers:[1,4,6]} (by number) or {type:'LayerMask', layers:['player','walls']} (by name from layer_names_set); optional category defaults to '2d_physics'. All supported type tags: Vector2, Vector3, Vector4, Vector2i, Vector3i, Color, Rect2, Rect2i, Transform2D, Transform3D, NodePath, Resource, NewResource, PackedVector2Array, PackedVector3Array, PackedColorArray, LayerMask. Unknown type tags are rejected with an error listing supported types.  Anchor presets: setting anchors_preset alone may not auto-apply underlying values. For reliable layout, set anchor_left/top/right/bottom and offset_left/top/right/bottom explicitly.  Batch mode: pass batch:[{node_path, property, value, make_unique?}, ...] to set multiple properties at once.

**eager**

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `batch` | array | no | Batch mode: array of {node_path, property, value, make_unique?}. Omit for single-property operations. When present, top-level node_path/property/value are ignored. |
| `make_unique` | boolean | no | When true and the compound path targets an external (.tres) sub-resource, auto-duplicate it as an inline copy before setting. Equivalent to the Inspector's 'Make Unique'. Only needed for compound paths on external resources. |
| `node_path` | string | no | Single mode: path to target node |
| `property` | string | no | Single mode: property name. Compound '/' paths supported. Use ':' for sub-resource chaining (e.g. 'material:shader_parameter/value'). |
| `value` | any | no |  |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:node_get_property_list -->
### `node_get_property_list`

Introspect node properties. mask: common (default), all, groups, script. 'script' returns all script variables with public/private label; use visibility param to filter.

**eager** · read-only

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `mask` | enum | no | Property filter. 'common' (default) returns 8-12 most-edited. 'all' returns full list. 'groups' returns names+usage only. 'script' returns script variables with visibility label. Prefer 'common' or node_get_property; 'all' returns the full list and is large. |
| `node_path` | string | yes |  |
| `visibility` | enum | yes | Filter for mask='script'. 'public' = no _ prefix, 'private' = _ prefix, 'all' = both. |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:node_set_script -->
### `node_set_script`

Attach a script (.gd/.cs) to a node. Returns @export properties exposed by the script. Empty script_path string detaches.

**eager**

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `node_path` | string | yes |  |
| `script_path` | string | yes |  |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:control_set_layout -->
### `control_set_layout`

Set anchor preset + optional margins on a Control node in one call. Uses set_anchors_and_offsets_preset(). Returns final_rect.

**eager**

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `margins` | object | no | Additive offsets applied after the preset (in pixels). |
| `node_path` | string | yes |  |
| `preset` | string | yes | Layout preset: PRESET_TOP_LEFT, PRESET_TOP_RIGHT, PRESET_BOTTOM_LEFT, PRESET_BOTTOM_RIGHT, PRESET_CENTER_LEFT, PRESET_CENTER_TOP, PRESET_CENTER_RIGHT, PRESET_CENTER_BOTTOM, PRESET_CENTER, PRESET_LEFT_WIDE, PRESET_TOP_WIDE, PRESET_RIGHT_WIDE, PRESET_BOTTOM_WIDE, PRESET_VCENTER_WIDE, PRESET_HCENTER_WIDE, PRESET_FULL_RECT |
| `resize_mode` | enum | no | keep_size (default) preserves size; set_to_anchors resizes to anchor region. |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:node_call_method -->
### `node_call_method`

Call method with args on an edited-scene node (editor-only; for runtime nodes use execute_code).

**eager** · destructive

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `args` | array | no |  |
| `method_name` | string | yes |  |
| `node_path` | string | yes |  |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:node_manage -->
### `node_manage`

Structural node operations on the edited scene tree.  action: rename — requires new_name. action: reparent — requires new_parent_path, optional keep_global_transform (default true). action: reorder — requires new_index (0-based sibling index). action: duplicate — optional new_name, parent_path, properties (overrides like {position:{x,y}}).

**eager**

**4 operations** (`action`): `rename`, `reparent`, `reorder`, `duplicate`

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `action` | enum | yes |  |
| `keep_global_transform` | boolean | no | For reparent: preserve world transform. Default true. |
| `new_index` | integer | no | For reorder: 0-based sibling index. |
| `new_name` | string | no | Required for rename; optional for duplicate. |
| `new_parent_path` | string | no | Required for reparent. |
| `node_path` | string | yes |  |
| `parent_path` | string | no | For duplicate: target parent. Defaults to same parent. |
| `properties` | object | no | For duplicate: property overrides on the copy (e.g. {position:{x:100,y:200}}). |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:node_groups -->
### `node_groups`

Manage node group membership. Groups are the idiomatic Godot way to tag and query game objects (e.g. 'coins', 'enemies').  Single mode: node_path + group (node_path required for add/remove/list). Batch mode: entries array of {node_path, group} carries per-item paths, and the top-level node_path/group are ignored.  action: add — requires group. action: remove — requires group. action: list — returns all groups (single only).

**eager**

**3 operations** (`action`): `add`, `remove`, `list`

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `action` | enum | yes |  |
| `entries` | array | no | Batch mode (add/remove only): array of {node_path, group}. When present, processes all entries as a batch.node_path and group params are ignored in batch mode. |
| `group` | string | no | Group name. Required for single add/remove. |
| `node_path` | string | no | Single mode: target node path. Required for single add/remove/list; omit in batch mode (provide entries instead). |
| `persistent` | boolean | no | For add: save to .tscn. Default true. |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:autoload_manage -->
### `autoload_manage`

Manage project autoload singletons (GameManager, AudioManager, etc.). Writes to project.godot; takes effect on next game launch.  action: register — requires name + script_path. action: unregister — requires name. action: list — returns all.

**eager**

**3 operations** (`action`): `register`, `unregister`, `list`

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `action` | enum | yes |  |
| `enabled` | boolean | no | For register: auto-initialize on startup. Default true. |
| `name` | string | no | Autoload name (e.g. 'GameManager'). Required for register/unregister. |
| `script_path` | string | no | Script path (e.g. 'res://scripts/game_manager.gd'). Required for register. |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:game_start -->
### `game_start`

Start playtest. Blocks until runtime is ready by default; wait_for_runtime:false launches without blocking. scene_path:'main'|'current'(default)|res://path. if_running:'return' for idempotent mode.

**eager**

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `if_running` | enum | no |  |
| `runtime_poll` | boolean | no | With if_running:'return', re-check whether the already-running game's runtime has since connected. Default false. |
| `scene_path` | string | no |  |
| `wait_for_runtime` | boolean | yes | Defaults true — blocks until runtime connects (or times out) so runtime tools are immediately available. Pass wait_for_runtime:false to launch without blocking. |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:game_stop -->
### `game_stop`

Stop the currently-playing scene (idempotent — returns was_running:false if nothing was running). No params.

**eager** · destructive

_1 operation._

_No parameters._

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:runtime_screenshot -->
### `runtime_screenshot`

Capture the running game window. Requires an active playtest (game_start). Use editor_screenshot for the editor viewport. image_response_mode 'disk' saves the PNG and returns only its path.

**eager** · read-only

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `force_foreground_game` | boolean | no | If true, un-minimize + raise/focus the game window before capturing (default false). Set it when runtime_screenshot reports RUNTIME_WINDOW_MINIMIZED; leave false to avoid fighting for focus (esp. parallel game instances). |
| `image_detail` | enum | no | Resolution of the returned inline image only. full = native; mid ≈ 1024 px long edge; low ≈ 512 px (gross layout/motion only — not for reading text). Does not affect files written to disk. |
| `image_response_mode` | enum | no | How to return the capture: 'inline' (default) embeds the PNG; 'disk' persists it and returns only the path — use for very large captures or to conserve context tokens; 'both' does both. Files written to disk are always full resolution, regardless of image_detail. |
| `save_path` | string | no | Destination .png used by image_response_mode disk/both (user://screenshots/ only); auto-named when omitted. |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:debugger_get_log -->
### `debugger_get_log`

Game output log. Works during gameplay AND after crash (auto-serves cached output). print()/push_* from a running game are captured here on every version (4.2-4.7) — the 'read my own prints to validate a flow' path. Compile errors will NOT appear here (the game must run); use script_check (one file) or lsp_project_diagnostics (whole project). source='buffer'|'file'. limit=200. text_filter + is_regex for search. +returned/total_lines/has_more (capped tail). Right after game_stop the first call may return GAME_NOT_RUNNING while the session registry settles — retry once (the cache serves the next call).

**eager** · read-only

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `is_regex` | boolean | no | Treat text_filter as a regex pattern instead of a plain substring (default false). |
| `limit` | integer | no |  |
| `source` | enum | no |  |
| `text_filter` | string | no | Substring to match against log message text (case-insensitive). Set is_regex=true for regex. |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:input_simulate -->
### `input_simulate`

Inject input into the running game. events: single {event_type, event_data?, delay_before_ms?, delay_after_ms?} for one action, or an array for a sequence of actions (prefer a single call with multiple events over separate calls). Types: key|mouse_button|mouse_motion|action|click|click_node|send_text. click is a composite: auto-focus + warp_mouse + press + 50ms delay + release via push_input (GUI-safe). click_node takes {node_path} — calls grab_focus + emits pressed on BaseButtons (no coordinate guessing). send_text types a string into the focused text field (or the event_data.node_path-targeted Control) by synthesizing per-character key events via push_input, firing the real text_changed/text_submitted signals that setting .text skips. send_text event_data: text (required), node_path? (a Control to focus first), submit? (append Enter); it returns focus_target, focus_source, text_changed, text_after (secret fields redacted), chars_sent, and a hint.  Mouse coordinate modes: - position: {x, y} — raw viewport/screen coordinates (default). Use for UI elements (buttons, menus). - world_position: {x, y} — game-world coordinates, auto-translated via canvas transform (accounts for camera offset and zoom). Use for clicking at specific in-game locations.  Mouse events auto-focus the game window and route through push_input for CanvasLayer/GUI support. Returns per-event diagnostics.

**eager**

**7 operations** (operation): `key`, `mouse_button`, `mouse_motion`, `action`, `click`, `click_node`, `send_text`

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `events` | union | yes |  |
| `summary` | boolean | no |  |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:runtime_get_script_vars -->
### `runtime_get_script_vars`

Get script variables (names, values, public/private) for a live game node. Complements runtime_get_node_state (engine props only). visibility param filters.

**eager** · read-only

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `node_path` | string | yes |  |
| `visibility` | enum | yes |  |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:execute_code -->
### `execute_code`

DANGER: evaluates a GDScript expression. Expression-only — no var/return/if/for statements, no = assignment.  context: 'game' (default) runs in the running game, 'editor' runs in the editor process.  To set properties: get_node('/root/Main/Player').set('speed', 400) To call methods: get_node('/root/Main/Player').call('take_damage', 25) To read values: get_node('/root/Main/Player').position  Prefer runtime_set_property for single property changes (safer, no expression syntax). Use execute_code for complex multi-step operations or method calls with specific arguments. If C# project, managed methods are callable at runtime (context:'game').  LIMITATION: Expression cannot access engine singletons (EditorInterface, Engine, OS, Input) or call load()/preload(). Property chaining on method return values (get_node('X').position) may fail due to Variant type erasure — use scope_path to bind the node as self, or use .get('property') instead (get_node('X').get('position') works reliably).

**eager** · destructive

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `code` | string | yes |  |
| `context` | enum | no | 'game' (default) evaluates in the running game — needs game_start first, else GAME_NOT_RUNNING; 'editor' evaluates in the editor process, no running game needed — use it for editor-state expressions. |
| `scope_path` | string | no |  |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:scene_get_tree -->
### `scene_get_tree`

Return the current edited scene's node tree as nested JSON { name, class, path, children }. Paths use "." for root — pass them directly to other editor commands.

**eager** · read-only

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `include_properties` | boolean | no | Embed property snapshot per node. Default false. |
| `max_depth` | number | no | Tree depth. Default 2. Use -1 for full tree. |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:scene_create_node -->
### `scene_create_node`

Create a node of class_name under parent. Supports engine + user-defined class_name classes. Idempotent: 'returned' on collision, 'created' on fresh.  Example: class_name: "CharacterBody2D", parent_path: ".", node_name: "Player"

**eager** · idempotent

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `class_name` | string | yes |  |
| `layout_mode` | number | no | Layout mode for Control nodes: 0=free, 1=anchors. Auto-sets 1 when parent is Container. |
| `node_name` | string | no |  |
| `parent_path` | string | yes |  |
| `properties` | object | no | Inline property values set after creation. Same coercion as node_set_property. Partial failure keeps the node — check properties_failed. Dict iteration order is not guaranteed. |
| `unique_name` | boolean | no | Mark as scene-unique node for %Name access in scripts. Warns if name collides with existing unique node. |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:scene_delete_node -->
### `scene_delete_node`

Delete the node at path (NodePath). Refuses to delete the edited scene root.

**eager** · destructive

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `node_path` | string | yes |  |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:scene_create -->
### `scene_create`

Create .tscn at file_path. Root name = filename stem at '.'. root_type default Node. Idempotent: created|returned|replaced. if_exists: return|fail|replace. Use scene_open afterward to edit.

**eager** · idempotent

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `file_path` | string | yes |  |
| `if_exists` | enum | no |  |
| `root_name` | string | no | Root node name override (default: filename stem). |
| `root_type` | string | no |  |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:scene_query -->
### `scene_query`

Search scene tree with filters (class, group, name glob, property conditions). Returns matching nodes. Faster than scene_get_tree + manual filtering. Paged: returned, total_matches, has_more. When has_more, page via next_offset until has_more is false. Stable only if the source is unchanged between calls. Results are returned in deterministic depth-first order; nodes echoes offset/limit. limit is 1-200 (default 50, clamped above 200). If the tree changes between paged reads (nodes added, removed, or reordered) results may skip or repeat — re-query from offset 0.

**eager** · read-only

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `class_filter` | string | no | Class name filter (inheritance-aware, e.g. 'CollisionShape2D', 'Control') |
| `group_filter` | string | no | Node group membership filter |
| `include_properties` | array | no | Property names to include in results |
| `limit` | integer | no | Page size (default per tool); a request above the cap is clamped and limit_clamped is set. |
| `max_depth` | integer | no | Max traversal depth (-1 = unlimited, default -1) |
| `name_pattern` | string | no | Glob pattern for node name (e.g. 'Enemy*', '*Collision*') |
| `offset` | integer | no | Skip the first N (default 0); pass next_offset back as offset until has_more is false. |
| `property_filters` | array | no | Property value conditions (AND logic) |
| `root_path` | string | no | Subtree root path (default: scene root) |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:script_read -->
### `script_read`

Read a script file (res:// only). Returns the file content as text in an <untrusted> envelope. Read large scripts in successive line windows via start_line/end_line (1-indexed, inclusive). Paged: returned, total_lines, has_more. When has_more, page via next_start_line until has_more is false.

**eager** · read-only

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `end_line` | integer | no | 1-based last line to read (inclusive). |
| `file_path` | string | yes |  |
| `start_line` | integer | no | 1-based first line (default 1); pass next_start_line back as start_line to page. |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:script_write -->
### `script_write`

Write .gd/.cs/.gdshader/.gdshaderinc at file_path (res:// only, creates or overwrites). For .gd files, returns inline diagnostics (valid: bool, diagnostics: [...]) — check valid before proceeding. Not idempotent. Use script.delete to remove; resource.create for .tres; scene.create for .tscn.

**eager**

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `content` | string | yes |  |
| `file_path` | string | yes |  |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:script_edit -->
### `script_edit`

Surgically replace a span in an existing .gd/.cs/.gdshader/.gdshaderinc file (res:// only) — the MCP analogue of the native Edit tool. old_string must match the file byte-for-byte (whitespace and indentation included); no regex, no fuzzy match. old_string not found -> NOT_FOUND; matches more than once without replace_all -> NOT_UNIQUE. new_string:'' deletes the span. replace_all replaces every occurrence and returns replacements:N. Prefer this over rewriting the whole file with script_write for a small change — it keeps the editor undo entry, reindexing, and inline diagnostics. For .gd files, returns inline diagnostics (valid: bool, diagnostics: [...]) — check valid before proceeding.

**eager**

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `file_path` | string | yes |  |
| `new_string` | string | yes | replacement text; empty string deletes the span |
| `old_string` | string | yes | exact byte-for-byte span to replace (whitespace/indent must match) |
| `replace_all` | boolean | no | replace every occurrence instead of requiring a unique match (default false) |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:script_check -->
### `script_check`

Offline GDScript validation — pass/fail + diagnostics. On 4.5+ the error diagnostic carries the real line (1-based; omitted on 4.2-4.4). Columns are lsp_diagnostics' domain. Works without editor.

**eager** · read-only

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `file_path` | string | yes | res:// path to a .gd file |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:signal_list -->
### `signal_list`

List signals on a node. include_connections=true adds targets ({target_path, method_name, flags}). flags & 2 = CONNECT_PERSIST (saved in .tscn).

**eager** · read-only

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `include_connections` | boolean | no |  |
| `node_path` | string | yes |  |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:signal_manage -->
### `signal_manage`

Connect or disconnect a signal (editor-time, CONNECT_PERSIST — saved in .tscn, survives save/load). Idempotent connect (status 'returned' on collision).

**eager** · idempotent

**2 operations** (`action`): `connect`, `disconnect`

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `action` | enum | yes |  |
| `method_name` | string | yes |  |
| `node_path` | string | yes |  |
| `signal_name` | string | yes |  |
| `target_path` | string | yes |  |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:scene_spatial_map -->
### `scene_spatial_map`

Spatial layout of the current scene: per-node world position, bounds (2D Rect2 / 3D AABB), size, plus computed overlaps/gaps/containment. Call before placing or moving nodes to find clear space. Paged: returned, total_nodes, has_more. Cursor-less — narrow with subtree/class/region/radius or raise max_nodes for more.

**eager** · read-only

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `center` | array | no | Center for radius filter: [x,y] (2D) or [x,y,z] (3D) |
| `class` | string | no | Only include nodes of this class (ancestry-aware) |
| `detail` | enum | no | brief = position/size only; normal = + bounds + overlaps; full = + containment + nearest-neighbour gaps |
| `max_nodes` | number | no | Response cap (default 200, max 1000) |
| `radius` | number | no | Only nodes within this distance of center |
| `region` | array | no | Only nodes intersecting this box: [x,y,w,h] (2D) or [x,y,z,sx,sy,sz] (3D) |
| `subtree` | string | no | Map only this node and its descendants (node path relative to the scene root) |

<!-- examples:start -->
<!-- examples:end -->

## Group: runtime_advanced

Inspect live node state, set node properties, and control AnimationPlayer during playtests

_3 tools, 6 operations._

<!-- tool:runtime_get_node_state -->
### `runtime_get_node_state`

Inspect a live node in the running game. Returns { name, class, path, properties } — primarily @export vars and inspector-visible fields.

on-demand (group: `runtime_advanced`) · read-only

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `node_path` | string | yes |  |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:runtime_set_property -->
### `runtime_set_property`

Set a property on a node in the running game. Requires a running game (use game_start first). For editor-time scene editing, use node_set_property instead.  Examples:   node_path: "/root/Main/Player", property: "speed", value: 400   node_path: "/root/Main/Enemy", property: "health", value: 0   node_path: "/root/Main/HUD/ScoreLabel", property: "text", value: "Score: 999"

on-demand (group: `runtime_advanced`)

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `node_path` | string | yes | Absolute path to the node in the running scene tree |
| `property` | string | yes | Property name (supports compound paths like 'position:x') |
| `value` | union | yes | Value to set — type is coerced to match the property's existing type |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:animation_player_control -->
### `animation_player_control`

Drive an AnimationPlayer in the running game. operation: play|pause|stop|seek. Optional animation_name (play) or time (seek). Returns post-op state.

on-demand (group: `runtime_advanced`)

**4 operations** (`operation`): `play`, `pause`, `stop`, `seek`

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `animation_name` | string | no |  |
| `node_path` | string | yes |  |
| `operation` | enum | yes |  |
| `time` | number | no |  |

<!-- examples:start -->
<!-- examples:end -->

## Group: signals

Emit signals on scene nodes at editor-time or runtime

_1 tool, 1 operations._

<!-- tool:signal_emit -->
### `signal_emit`

Emit signal_name on node with optional args. mode='editor' (default, edited scene) or mode='runtime' (the running game).

on-demand (group: `signals`)

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `args` | array | no |  |
| `mode` | enum | no |  |
| `node_path` | string | yes |  |
| `signal_name` | string | yes |  |

<!-- examples:start -->
<!-- examples:end -->

## Group: animation_authoring

Inspect and author keyframes, edit tracks, and configure AnimationTree state machines

_4 tools, 10 operations._

<!-- tool:animation_keyframe -->
### `animation_keyframe`

Add/remove a keyframe on an existing animation's track. animation must already exist; action='add' auto-creates the track only. Idempotent on exact-time dup.

on-demand (group: `animation_authoring`) · idempotent

**2 operations** (`action`): `add`, `remove`

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `action` | enum | yes |  |
| `animation_name` | string | yes |  |
| `player_path` | string | yes |  |
| `time` | number | yes |  |
| `track_path` | string | yes |  |
| `track_type` | enum | no | Track type; only 'value' supported currently. |
| `value` | any | no | Required for action='add'. |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:animation_get_keys -->
### `animation_get_keys`

List keys on an AnimationPlayer track: { time, value, transition }. Read-only; no auto-track-create.

on-demand (group: `animation_authoring`) · read-only

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `animation_name` | string | yes |  |
| `player_path` | string | yes |  |
| `track_path` | string | yes |  |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:animationtree_edit -->
### `animationtree_edit`

Configure AnimationTree state machines: set root, add/remove nodes and transitions, or set properties.

on-demand (group: `animation_authoring`) · destructive · idempotent

**6 operations** (`action`): `set_root`, `add_node`, `remove_node`, `add_transition`, `remove_transition`, `set_property`

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `action` | enum | yes | Operation to perform on the AnimationTree. |
| `advance_condition` | string | no | For add_transition: condition name for conditional advance. |
| `advance_mode` | enum | no | For add_transition: advance mode (disabled=0, enabled=1, auto=2). |
| `animation_name` | string | no | For add_node with AnimationNodeAnimation: which animation to play. |
| `from` | string | no | For transitions: source node name. |
| `node_name` | string | no | For add_node/remove_node: name of the state machine node. |
| `node_path` | string | yes | Path to an AnimationTree node in the edited scene. |
| `node_type` | string | no | For add_node: AnimationNode subclass (e.g. AnimationNodeAnimation, AnimationNodeBlendSpace2D). |
| `position` | object | no | For add_node: graph position { x, y }. |
| `property` | string | no | For set_property: property name to set. |
| `root_type` | enum | no | For set_root: type of root node to create. |
| `switch_mode` | enum | no | For add_transition: when the transition fires. |
| `target_node` | string | no | For set_property: node name in the state machine. |
| `to` | string | no | For transitions: destination node name. |
| `value` | any | no | For set_property: value to assign. |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:animationtree_list -->
### `animationtree_list`

List an AnimationTree state machine's structure: root type, nodes, and transitions. Read-only; no mutation.

on-demand (group: `animation_authoring`) · read-only

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `node_path` | string | yes | Path to an AnimationTree node in the edited scene. |

<!-- examples:start -->
<!-- examples:end -->

## Group: input_map

List, create, and edit input actions and their key/controller bindings

_2 tools, 4 operations._

<!-- tool:input_map_action -->
### `input_map_action`

Add or remove an InputMap action. action: 'add' or 'remove' (the operation). name: the input map name (e.g. 'jump', 'move_left'). action='add' is idempotent with optional deadzone.

on-demand (group: `input_map`)

**2 operations** (`action`): `add`, `remove`

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `action` | enum | yes |  |
| `deadzone` | number | no |  |
| `name` | string | yes |  |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:input_map_event -->
### `input_map_event`

Bind/unbind an input event to an action. action: 'bind' or 'unbind' (the operation). event: object — {type:'key', keycode:'Space'}, {type:'mouse_button', button_index:1}, {type:'joypad_button', button_index:0}, {type:'joypad_motion', axis:0, axis_value:1.0}. action='bind' is idempotent.

on-demand (group: `input_map`)

**2 operations** (`action`): `bind`, `unbind`

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `action` | enum | yes |  |
| `event` | object | yes |  |
| `name` | string | yes |  |

<!-- examples:start -->
<!-- examples:end -->

## Group: resource_io

Load and write Godot resources (.tres/.res) programmatically

_2 tools, 2 operations._

<!-- tool:resource_load -->
### `resource_load`

Load a res:// resource and return { class, path, properties, metadata }. Heavy fields (image, mesh_arrays) pruned; Texture2D gets size in metadata.

on-demand (group: `resource_io`) · read-only

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `file_path` | string | yes |  |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:resource_write -->
### `resource_write`

Write/create a .tres/.res resource. If file exists, updates properties. If not, 'type' (class name) is required to create it. For TileSets, use tileset_create instead (handles atlas + physics setup).

on-demand (group: `resource_io`) · idempotent

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `file_path` | string | yes |  |
| `properties` | object | no | Property values. Sub-resources in dicts: use {type:'NewResource', class:'ClassName', properties:{...}}. |
| `type` | string | no | Resource class name. Required when creating a new resource. |

<!-- examples:start -->
<!-- examples:end -->

## Group: asset_ops

List assets, query dependencies, and import binary files into the project

_3 tools, 3 operations._

<!-- tool:asset_list -->
### `asset_list`

Enumerate res:// assets with filters (path_prefix, name_glob, class_filter ancestry-aware, extension_filter). Returns [{path,class,modified_unix}]. Paged: returned, total_assets, has_more. Cursor-less — narrow filters or raise limit for more. limit caps at 2000 (default 500); a request above 2000 is clamped and limit_clamped is set (a non-positive limit is rejected).

on-demand (group: `asset_ops`) · read-only

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `class_filter` | string | no |  |
| `extension_filter` | array | no |  |
| `limit` | number | no | Max assets returned (default 500, clamped to 2000) |
| `name_glob` | string | no |  |
| `path_prefix` | string | no |  |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:asset_get_dependencies -->
### `asset_get_dependencies`

Forward dependencies of a res:// resource/scene via EditorFileSystem cache. include_transitive walks deps-of-deps. Returns [{path,raw_path,class}]. Paged: returned, total_dependencies, has_more. Cursor-less — narrow the query or raise limit for more.

on-demand (group: `asset_ops`) · read-only

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `file_path` | string | yes |  |
| `include_transitive` | boolean | no |  |
| `limit` | number | no | Max dependencies returned (default 200) |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:asset_import -->
### `asset_import`

Import binary asset (image/audio/font/3D) into res:// via exactly one of source_path (absolute or res:// path) or base64_data. Triggers EditorFileSystem scan. if_exists:return|fail|replace.

on-demand (group: `asset_ops`) · idempotent

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `base64_data` | string | no |  |
| `dest_path` | string | yes |  |
| `if_exists` | enum | no |  |
| `source_path` | string | no |  |
| `wait_for_scan_ms` | number | no |  |

<!-- examples:start -->
<!-- examples:end -->

## Group: placeholders

Generate placeholder/prototype assets procedurally — textures (shapes, patterns, labels) and sound effects (tones, noise). No art or network needed.

_2 tools, 2 operations._

<!-- tool:texture_generate -->
### `texture_generate`

Generate a placeholder PNG (imports as Texture2D): a shape (solid/circle/triangle/diamond/arrow/checkerboard/grid) with fill/outline/background colours + an optional text label. Dimensions <=1024px.

on-demand (group: `placeholders`)

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `background_color` | union | no | Canvas colour behind the shape (default transparent) |
| `cell_size` | number | no | Cell size for checkerboard/grid |
| `direction` | enum | no | Arrow direction |
| `file_path` | string | yes | res:// destination ending in .png |
| `fill_color` | union | no | Interior colour; transparent = hollow shape |
| `height` | number | no | Pixels, 1-1024 (default 64) |
| `if_exists` | enum | no |  |
| `label` | string | no | Optional text overlaid centred on any shape |
| `label_color` | union | no |  |
| `outline_color` | union | no | Border colour; transparent/omitted = no border |
| `outline_width` | number | no | Border thickness in pixels (default 1) |
| `shape` | enum | no |  |
| `wait_for_scan_ms` | number | no |  |
| `width` | number | no | Pixels, 1-1024 (default 64) |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:sound_generate -->
### `sound_generate`

Generate a placeholder sound effect (mono WAV): waveform sine/square/triangle/sawtooth/noise, frequency, duration <=5s, volume, optional pitch sweep + fade/decay envelope. SFX only, no music.

on-demand (group: `placeholders`)

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `decay` | number | no | Exponential decay time-constant in seconds (>0 = pluck/bell) |
| `duration` | number | no | Seconds, max 5 (default 0.3) |
| `end_frequency` | number | no | If set, pitch sweeps frequency -> end_frequency over the duration |
| `fade_in` | number | no | Fade-in seconds (default ~0.003 de-click) |
| `fade_out` | number | no | Fade-out seconds (default ~0.003 de-click) |
| `file_path` | string | yes | res:// destination ending in .wav |
| `frequency` | number | no | Hz (default 440; ignored for noise) |
| `if_exists` | enum | no |  |
| `volume` | number | no | Peak amplitude 0-1 (default 0.8) |
| `wait_for_scan_ms` | number | no |  |
| `waveform` | enum | no |  |

<!-- examples:start -->
<!-- examples:end -->

## Group: cleanup

Delete files, scripts, scenes, resources, and folders; close open scenes

_6 tools, 6 operations._

<!-- tool:file_delete -->
### `file_delete`

Delete any file under res:// and its .import companion. Auto-closes .tscn/.scn editor tabs on 4.5+ (tab_closed:true). Use for assets not covered by scene/script/resource.delete.

on-demand (group: `cleanup`) · destructive

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `file_path` | string | yes |  |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:scene_delete -->
### `scene_delete`

Delete .tscn at path and .uid companion. Auto-closes editor tab on 4.5+ (tab_closed:true). 4.2-4.4: blocks active scene (EDITED_SCENE); non-active tabs get phantom warnings. Refuses non-.tscn.

on-demand (group: `cleanup`) · destructive

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `file_path` | string | yes |  |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:script_delete -->
### `script_delete`

Delete .gd/.cs/.gdshader/.gdshaderinc at file_path (and .uid companion). Refuses non-script paths (INVALID_PATH). No open-in-editor guard.

on-demand (group: `cleanup`) · destructive

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `file_path` | string | yes |  |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:resource_delete -->
### `resource_delete`

Delete the .tres/.res and its .uid companion at file_path. No active-use guard (Godot refs survive file deletion; detect orphans via editor_get_console).

on-demand (group: `cleanup`) · destructive

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `file_path` | string | yes |  |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:folder_delete -->
### `folder_delete`

Delete directory. recursive:false(default) requires empty. On 4.5+ closes one open scene tab; multiple in stale_tabs - use scene_close. Refuses project root, addons, open scripts (PATH_IN_USE).

on-demand (group: `cleanup`) · destructive

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | string | yes |  |
| `recursive` | boolean | no |  |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:scene_close -->
### `scene_close`

Close an open scene tab by file_path. Discards unsaved edits — save with editor_save_scene first. Auto-creates an empty scene when the last tab closes. NOT_FOUND if not open. Requires Godot 4.5+.

on-demand (group: `cleanup`) · Godot 4.5+ · destructive

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `file_path` | string | yes |  |

<!-- examples:start -->
<!-- examples:end -->

## Group: user_data

Read, write, delete, and list user:// save files

_4 tools, 4 operations._

<!-- tool:save_read -->
### `save_read`

Read user:// file (default 64 KB window; cap configurable, default 256 KB). Read large files in successive max_bytes windows via byte offset. Paged: returned, total_bytes, has_more. When has_more, page via next_offset until has_more is false. Returns UTF-8 content in <untrusted> envelope, or base64 if non-UTF-8.

on-demand (group: `user_data`) · read-only

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `max_bytes` | integer | no | Bytes to read this window (default 64 KB; cap configurable, default 256 KB) |
| `offset` | integer | no | Byte offset to start at (default 0); pass next_offset back to page. |
| `path` | string | yes | user:// file path |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:save_write -->
### `save_write`

Write to user:// file. Not idempotent. Creates parent dirs. Plugin internals path denied.

on-demand (group: `user_data`) · destructive

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `content` | string | yes |  |
| `path` | string | yes |  |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:save_delete -->
### `save_delete`

Delete user:// file. NOT_FOUND if missing. Plugin internals path denied.

on-demand (group: `user_data`) · destructive

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | string | yes |  |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:save_list -->
### `save_list`

List files + subdirs in a user:// directory (path must end /). Names only — agent issues follow-up save.list for recursion.

on-demand (group: `user_data`) · read-only

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | string | yes |  |

<!-- examples:start -->
<!-- examples:end -->

## Group: scene_advanced

Diff scenes and batch-instantiate nodes from packed scenes

_2 tools, 2 operations._

<!-- tool:scene_diff -->
### `scene_diff`

Compare a prior scene-tree snapshot against another snapshot (or current edited scene if 'after' omitted). Returns { changed, diff, added, removed }.

on-demand (group: `scene_advanced`) · read-only

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `after` | any | no |  |
| `before` | any | yes |  |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:scene_instantiate -->
### `scene_instantiate`

Instantiate PackedScene at scene_path under parent_path. Single mode: silent-return on name collision. Batch mode: pass instances array to spawn N copies with transforms.  Single: scene_path: "res://coin.tscn", parent_path: ".", as_name: "Coin" Batch: scene_path: "res://coin.tscn", parent_path: ".", instances: [{name:"Coin1",position:{x:100,y:200},properties:{coin_value:5}}, ...]

on-demand (group: `scene_advanced`)

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `as_name` | string | no | Single mode: instance name. |
| `instances` | array | no | Batch mode: array of {name?, position?, rotation?, scale?, properties?}. properties: arbitrary overrides applied after instantiation (e.g. {key_type: 'Gold'}). When present, spawns N instances as a batch. as_name and transform are ignored in batch mode. |
| `parent_path` | string | yes |  |
| `scene_path` | string | yes |  |
| `transform` | object | no | Single mode: property overrides. |

<!-- examples:start -->
<!-- examples:end -->

## Group: editor_advanced

Capture editor screenshots, refresh the filesystem, and wait for idle

_3 tools, 3 operations._

<!-- tool:editor_screenshot -->
### `editor_screenshot`

Capture the editor viewport (NOT the running game — use runtime_screenshot for that). Pass node_path to focus one node. image_response_mode 'disk' saves the PNG and returns only its path.

on-demand (group: `editor_advanced`) · read-only

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `force_foreground_editor` | boolean | no | If true, un-minimize + raise/focus the editor window before capturing (default false). Set it when driving from a terminal and editor_screenshot reports EDITOR_VIEWPORT_UNAVAILABLE; leave false in interactive use so your window isn't raised. |
| `image_detail` | enum | no | Resolution of the returned inline image only. full = native; mid ≈ 1024 px long edge; low ≈ 512 px (gross layout/motion only — not for reading text). Does not affect files written to disk. |
| `image_response_mode` | enum | no | How to return the capture: 'inline' (default) embeds the PNG; 'disk' persists it and returns only the path — use for very large captures or to conserve context tokens; 'both' does both. Files written to disk are always full resolution, regardless of image_detail. |
| `node_path` | string | no | Focus + capture a specific node instead of the full viewport |
| `save_path` | string | no | Destination .png used by image_response_mode disk/both (res:// or user://screenshots/); auto-named under user://screenshots/ when omitted. |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:editor_refresh -->
### `editor_refresh`

Refresh the editor's view of the filesystem — picks up new, changed, or deleted files (images, scenes, scripts, resources) and reloads open scripts. Call after creating files externally (e.g. Python, Bash) or after batch edits. With file_paths, targets specific files (O(1) per file). Without, does a full project rescan + reimport.

on-demand (group: `editor_advanced`)

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `file_paths` | array | no | res:// paths to update; omit for full scan |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:editor_wait_for_idle -->
### `editor_wait_for_idle`

Poll EditorFileSystem.is_scanning() until idle or timeout_ms (default 10s, cap 30s). Use after asset.import, editor.refresh, or file mutations.

on-demand (group: `editor_advanced`) · read-only

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `timeout_ms` | number | no |  |

<!-- examples:start -->
<!-- examples:end -->

## Group: tilemap

Read and paint cells on TileMap/TileMapLayer nodes — cell queries, bulk fills, and region operations

_2 tools, 2 operations._

<!-- tool:tilemap_read_cells -->
### `tilemap_read_cells`

Read placed tile data from a TileMapLayer (4.3+) or deprecated TileMap. Returns cell coords, source_id, atlas_coords. 500-cell cap. Paged: returned, total_cells, has_more. Cursor-less — narrow with region/source_id for more.

on-demand (group: `tilemap`) · read-only

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `layer` | integer | no | Layer index for deprecated TileMap (default 0) |
| `node_path` | string | yes | Path to TileMapLayer or TileMap node |
| `region` | object | no | Spatial filter: only cells within {x, y, width, height} |
| `source_id` | integer | no | Filter to cells from this atlas source |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:tilemap_set_cells -->
### `tilemap_set_cells`

Batch-set cells on TileMap or TileMapLayer. Returns cells_written + cells_unchanged. source_id:-1 clears a cell. Use 'regions' for bulk rectangular fills (far more efficient than listing individual cells).

on-demand (group: `tilemap`)

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `cells` | array | no | Array of {x, y, source_id, atlas_x, atlas_y, alternative_tile?}. source_id:-1 clears. |
| `layer` | number | no |  |
| `node_path` | string | yes |  |
| `regions` | array | no | Array of rectangular fills: [{x, y, width, height, source_id, atlas_x, atlas_y, alternative_tile?}]. Each region expands into width*height cells. Far more efficient than listing individual cells for room-scale fills. Can be combined with 'cells' — regions are appended to cells. |

<!-- examples:start -->
<!-- examples:end -->

## Group: tileset

Create TileSet resources, add atlas sources, configure layers, and manage tile alternatives

_6 tools, 6 operations._

<!-- tool:tileset_create -->
### `tileset_create`

Create a TileSet .tres from a texture. Generates atlas tiles with full-tile rectangular collision (physics on by default). Returns source_id + grid dims — use these with tilemap_set_cells.

on-demand (group: `tileset`)

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `collision_layer` | union | no | Physics collision layer. Integer bitmask OR array of layer numbers [1,6] or names ['player','walls']. Default 1 |
| `collision_mask` | union | no | Physics collision mask. Integer bitmask OR array of layer numbers [2,4] or names ['enemies','collectibles']. Default 1 |
| `file_path` | string | yes | Output path, e.g. 'res://resources/tileset.tres' |
| `physics` | boolean | no | Add physics layer. Default true |
| `texture_path` | string | yes | Texture for the atlas source, e.g. 'res://assets/tiles.png' |
| `tile_size` | object | no | Tile size in pixels. Default {x:16, y:16} |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:tileset_add_source -->
### `tileset_add_source`

Add an atlas source to an existing TileSet. Auto-creates tiles for every grid cell in the texture. Returns the new source_id.

on-demand (group: `tileset`)

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `file_path` | string | yes | Path to existing .tres TileSet |
| `texture_path` | string | yes | Texture for the new atlas source |
| `tile_size` | object | no | Tile size in pixels. Defaults to the TileSet's tile_size |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:tileset_remove_source -->
### `tileset_remove_source`

Remove an atlas source from a TileSet. This deletes all tile data for that source.

on-demand (group: `tileset`) · destructive

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `file_path` | string | yes | Path to existing .tres TileSet |
| `source_id` | integer | yes | Atlas source id to remove |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:tileset_add_alternative -->
### `tileset_add_alternative`

Create an alternative tile variant (flip, rotate, recolor) for a base tile.

on-demand (group: `tileset`)

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `atlas_x` | integer | yes | Base tile X coordinate in the atlas |
| `atlas_y` | integer | yes | Base tile Y coordinate in the atlas |
| `file_path` | string | yes | Path to existing .tres TileSet |
| `flip_h` | boolean | no | Flip horizontally |
| `flip_v` | boolean | no | Flip vertically |
| `modulate` | object | no | Color modulation {r, g, b, a} — each 0.0–1.0 |
| `source_id` | integer | no | Atlas source id. Default 0 |
| `transpose` | boolean | no | Transpose (swap X/Y) |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:tileset_remove_alternative -->
### `tileset_remove_alternative`

Remove an alternative tile variant from a base tile.

on-demand (group: `tileset`) · destructive

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `alternative_id` | integer | yes | Alternative tile id to remove |
| `atlas_x` | integer | yes | Base tile X coordinate in the atlas |
| `atlas_y` | integer | yes | Base tile Y coordinate in the atlas |
| `file_path` | string | yes | Path to existing .tres TileSet |
| `source_id` | integer | no | Atlas source id. Default 0 |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:tileset_setup_layers -->
### `tileset_setup_layers`

Configure TileSet layers: terrain sets (with named terrains), custom data layers, and physics/navigation/occlusion layer counts.

on-demand (group: `tileset`)

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `custom_data` | array | no | Custom data layers to add |
| `file_path` | string | yes | Path to existing .tres TileSet |
| `navigation_layers` | integer | no | Desired navigation layer count |
| `occlusion_layers` | integer | no | Desired occlusion layer count |
| `physics_layers` | integer | no | Desired physics layer count |
| `terrain_sets` | array | no | Terrain sets to add |

<!-- examples:start -->
<!-- examples:end -->

## Group: tileset_edit

Edit per-tile properties: physics, terrain, navigation, visuals, and custom data

_5 tools, 5 operations._

<!-- tool:tileset_edit_physics -->
### `tileset_edit_physics`

Set collision polygons on TileSet tiles. Supports shortcuts ('full', 'none', 'one_way') or custom polygon arrays [{x, y}].

on-demand (group: `tileset_edit`)

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `file_path` | string | yes | Path to existing .tres TileSet |
| `source_id` | integer | no | Atlas source id. Default 0 |
| `tiles` | array | yes | Per-tile edits: [{atlas_x, atlas_y, physics_polygon: 'full'\|'none'\|'one_way'\|[{x,y}], physics_layer?: int, one_way_collision?: bool}] |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:tileset_edit_terrain -->
### `tileset_edit_terrain`

Assign terrain sets and peering bits to TileSet tiles for auto-tiling.

on-demand (group: `tileset_edit`)

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `file_path` | string | yes | Path to existing .tres TileSet |
| `source_id` | integer | no | Atlas source id. Default 0 |
| `tiles` | array | yes | Per-tile edits: [{atlas_x, atlas_y, terrain_set: int, terrain?: int, terrain_peering?: {right?: int, bottom?: int, left?: int, top?: int, ...}}] |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:tileset_edit_navigation -->
### `tileset_edit_navigation`

Set navigation polygons on TileSet tiles. Supports 'full', 'none', or custom polygon arrays.

on-demand (group: `tileset_edit`)

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `file_path` | string | yes | Path to existing .tres TileSet |
| `source_id` | integer | no | Atlas source id. Default 0 |
| `tiles` | array | yes | Per-tile edits: [{atlas_x, atlas_y, navigation_polygon: 'full'\|'none'\|[{x,y}], navigation_layer?: int}] |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:tileset_edit_visuals -->
### `tileset_edit_visuals`

Set occlusion polygons, tile animations, and probability weights on TileSet tiles.

on-demand (group: `tileset_edit`) · destructive

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `file_path` | string | yes | Path to existing .tres TileSet |
| `source_id` | integer | no | Atlas source id. Default 0 |
| `tiles` | array | yes | Per-tile edits: [{atlas_x, atlas_y, occlusion_polygon?: 'full'\|'none'\|[{x,y}], occlusion_layer?: int, animation?: {frame_count, columns?, frame_duration?, separation?}, probability?: number}] |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:tileset_edit_custom_data -->
### `tileset_edit_custom_data`

Set custom data values on TileSet tiles. Custom data layers must be configured first with tileset_setup_layers.

on-demand (group: `tileset_edit`)

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `file_path` | string | yes | Path to existing .tres TileSet |
| `source_id` | integer | no | Atlas source id. Default 0 |
| `tiles` | array | yes | Per-tile edits: [{atlas_x, atlas_y, custom_data: {"layer_name": value, ...}}] |

<!-- examples:start -->
<!-- examples:end -->

## Group: theme

Edit UI theme overrides: styleboxes, fonts, colors, and constants

_1 tool, 1 operations._

<!-- tool:theme_edit -->
### `theme_edit`

Create or modify a Godot Theme resource (.tres). Batch-edit colors, constants, fonts, font sizes, icons, and styleboxes for any control type.

on-demand (group: `theme`)

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `edits` | array | yes | Array of theme property edits to apply |
| `file_path` | string | yes | Theme resource path, e.g. 'res://themes/ui_theme.tres'. Created if missing. |

<!-- examples:start -->
<!-- examples:end -->

## Group: layer_naming

Get and set physics, render, and navigation layer names

_2 tools, 2 operations._

<!-- tool:layer_names_set -->
### `layer_names_set`

Set physics/render layer names. category: 2d_physics|2d_render|3d_physics|3d_render. layers: {1:'Ground', 2:'Player', …} (keys 1-32).

on-demand (group: `layer_naming`)

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `category` | enum | yes |  |
| `layers` | object | yes | Layer number (1-32) to name |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:layer_names_get -->
### `layer_names_get`

Read named physics/render layers. Returns only layers with non-empty names.

on-demand (group: `layer_naming`) · read-only

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `category` | enum | yes |  |

<!-- examples:start -->
<!-- examples:end -->

## Group: path_editing

Edit Path2D curves and generate collision shapes from sprite textures

_2 tools, 5 operations._

<!-- tool:path2d_edit_curve -->
### `path2d_edit_curve`

Edit a Path2D node's Curve2D — set, add, or remove points with bezier control handles. For patrol routes, moving platforms, projectile curves, and camera rails.

on-demand (group: `path_editing`)

**4 operations** (`action`): `set`, `add`, `remove`, `clear`

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `action` | enum | yes | set=replace all, add=append/insert, remove=delete at index, clear=remove all |
| `index` | integer | no | Insert position (add) or point index to remove |
| `node_path` | string | yes | Path2D node path in the scene tree |
| `points` | array | no | Curve points with optional bezier handles |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:collision_from_texture -->
### `collision_from_texture`

Auto-generate CollisionPolygon2D from a Sprite2D's texture alpha. Uses BitMap to trace opaque regions. For platformer terrain, character hitboxes, irregular shapes.

on-demand (group: `path_editing`)

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `parent_path` | string | no | Parent for the new CollisionPolygon2D (default: sprite's parent) |
| `simplification` | number | no | Polygon simplification epsilon 0.0-10.0 (default 2.0, higher=fewer points) |
| `sprite_path` | string | yes | Path to a Sprite2D/TextureRect node with a texture |
| `target_name` | string | no | Name for the CollisionPolygon2D (default: {sprite}_collision) |

<!-- examples:start -->
<!-- examples:end -->

## Group: 3d_tools

Create 3D primitives, lights, cameras, and environment setups

_4 tools, 4 operations._

<!-- tool:3d_create_primitive -->
### `3d_create_primitive`

Create a 3D mesh primitive (box, sphere, cylinder, capsule, plane, prism) as a MeshInstance3D node. Optionally set size, material, and position.

on-demand (group: `3d_tools`)

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `material` | object | no | Material to apply: {type:'StandardMaterial3D', albedo_color?, metallic?, roughness?} |
| `name` | string | no | Node name (default: 'MeshInstance3D') |
| `parent_path` | string | yes | Parent node path (e.g. '.' for scene root) |
| `position` | object | no | World position {x,y,z} |
| `primitive` | enum | yes | Mesh primitive type |
| `size` | object | no | Size as {x,y,z}. Interpretation depends on primitive: box→size, sphere→x=diameter/y=height, etc. |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:3d_setup_environment -->
### `3d_setup_environment`

Create a WorldEnvironment node with sky, ambient light, tonemapping, and fog. Sets up a complete 3D rendering environment.

on-demand (group: `3d_tools`)

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `ambient_light` | object | no | Ambient light: {color?, energy?} |
| `fog` | object | no | Fog settings: {enabled?, color?, density?} |
| `name` | string | no | Node name (default: 'WorldEnvironment') |
| `parent_path` | string | yes | Parent node path (e.g. '.' for scene root) |
| `sky` | object | no | Sky configuration |
| `tonemap` | enum | no | Tonemapping mode |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:3d_create_light -->
### `3d_create_light`

Create a 3D light node (DirectionalLight3D, OmniLight3D, or SpotLight3D). Optionally set color, energy, shadow, position, and rotation.

on-demand (group: `3d_tools`)

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `color` | object | no | Light color {r,g,b} |
| `energy` | number | no | Light energy/intensity |
| `light_type` | enum | yes | Light type |
| `name` | string | no | Node name (default: type-specific, e.g. 'DirectionalLight3D') |
| `parent_path` | string | yes | Parent node path (e.g. '.' for scene root) |
| `position` | object | no | World position {x,y,z} |
| `rotation` | object | no | Rotation in Euler degrees {x,y,z} |
| `shadow` | boolean | no | Enable shadow casting |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:3d_create_camera -->
### `3d_create_camera`

Create a Camera3D node. Set projection mode (perspective/orthogonal), FOV, position, rotation, and whether it's the current camera.

on-demand (group: `3d_tools`)

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `current` | boolean | no | Set as the current active camera |
| `fov` | number | no | Field of view in degrees (perspective mode) |
| `name` | string | no | Node name (default: 'Camera3D') |
| `parent_path` | string | yes | Parent node path (e.g. '.' for scene root) |
| `position` | object | no | World position {x,y,z} |
| `projection` | enum | no | Projection mode (default: perspective) |
| `rotation` | object | no | Rotation in Euler degrees {x,y,z} |
| `size` | number | no | Viewport size (orthogonal mode) |

<!-- examples:start -->
<!-- examples:end -->

## Group: procedural

Edit gradients, curves, and FastNoiseLite resources for procedural generation

_3 tools, 8 operations._

<!-- tool:procedural_edit_gradient -->
### `procedural_edit_gradient`

Create/edit a Gradient resource (.tres). Set color stops with offsets, add/remove points. For particles, sky, and visual effects.

on-demand (group: `procedural`)

**3 operations** (`action`): `set`, `add_point`, `remove_point`

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `action` | enum | no | set=replace all, add_point=add one, remove_point=delete by index (default: set) |
| `file_path` | string | yes | Path for the .tres file (e.g. 'res://materials/sky_gradient.tres') |
| `index` | integer | no | Point index (for remove_point) |
| `interpolation_mode` | enum | no | Interpolation between stops |
| `points` | array | no | Gradient color stops |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:procedural_edit_curve -->
### `procedural_edit_curve`

Create/edit a Curve resource (.tres). Set control points with tangents for easing, falloff, and value mapping.

on-demand (group: `procedural`)

**4 operations** (`action`): `set`, `add_point`, `remove_point`, `clear`

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `action` | enum | no | set=replace all, add_point=add one, remove_point=delete, clear=remove all (default: set) |
| `file_path` | string | yes | Path for the .tres file |
| `index` | integer | no | Point index (for remove_point) |
| `max_value` | number | no | Curve maximum Y value |
| `min_value` | number | no | Curve minimum Y value |
| `points` | array | no | Curve control points |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:procedural_edit_noise -->
### `procedural_edit_noise`

Create/edit a FastNoiseLite resource (.tres). Configure noise type, fractal, cellular, and domain warp for procedural generation.

on-demand (group: `procedural`)

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `cellular_distance_function` | enum | no |  |
| `cellular_return_type` | enum | no |  |
| `domain_warp_amplitude` | number | no |  |
| `domain_warp_enabled` | boolean | no |  |
| `file_path` | string | yes | Path for the .tres file |
| `fractal_type` | enum | no | Fractal type |
| `frequency` | number | no | Base frequency (default 0.01) |
| `gain` | number | no | Octave amplitude multiplier |
| `lacunarity` | number | no | Octave frequency multiplier |
| `noise_type` | enum | no | Noise algorithm |
| `octaves` | integer | no | Fractal octaves 1-10 |
| `seed` | integer | no | Random seed |

<!-- examples:start -->
<!-- examples:end -->

## Group: scene_inheritance

Create inherited scenes (variants) from base scenes

_1 tool, 1 operations._

<!-- tool:scene_create_inherited -->
### `scene_create_inherited`

Create an inherited scene (.tscn) from a base scene — Godot's prefab variant pattern. Writes minimal TSCN text, works on all 4.2-4.7.

on-demand (group: `scene_inheritance`)

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `base_scene` | string | yes | Base scene path (e.g. 'res://scenes/enemy.tscn') |
| `file_path` | string | yes | Output .tscn path (e.g. 'res://scenes/slime_enemy.tscn') |
| `root_name` | string | no | Root node name override (default: base scene's root name) |

<!-- examples:start -->
<!-- examples:end -->

## Group: audio

List and configure audio buses, effects, and volume settings

_2 tools, 6 operations._

<!-- tool:audiobus_edit -->
### `audiobus_edit`

Manage audio buses: add/remove buses, set volume/send/solo/mute, add/remove effects. bus_name takes priority over bus_index. Effect type: full class (AudioEffectReverb) or suffix (Reverb).

on-demand (group: `audio`) · destructive

**5 operations** (`action`): `add_bus`, `remove_bus`, `set_bus`, `add_effect`, `remove_effect`

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `action` | enum | yes | Bus operation |
| `bus_index` | integer | no | Bus index (alternative to name) |
| `bus_name` | string | no | Bus name |
| `effect` | object | no | Effect to add/remove |
| `mute` | boolean | no | Mute this bus |
| `send_to` | string | no | Parent bus name (default: Master) |
| `solo` | boolean | no | Solo this bus |
| `volume_db` | number | no | Volume in dB |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:audiobus_list -->
### `audiobus_list`

List all audio buses with volume/send/solo/mute and per-bus effects. Read-only snapshot of the bus layout.

on-demand (group: `audio`) · read-only

_1 operation._

_No parameters._

<!-- examples:start -->
<!-- examples:end -->

## Group: spriteframes

List, create, and edit SpriteFrames animations and import from spritesheets

_3 tools, 10 operations._

<!-- tool:spriteframes_create -->
### `spriteframes_create`

Create a SpriteFrames resource (.tres) with named animations and frame textures. For AnimatedSprite2D character/effect animation.

on-demand (group: `spriteframes`) · idempotent

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `animations` | array | yes | Animations with their frames |
| `file_path` | string | yes | Output .tres file path (res://) |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:spriteframes_edit -->
### `spriteframes_edit`

Edit an existing SpriteFrames resource: add/remove animations, add/remove/reorder frames, adjust fps/loop. 'list' returns all animations.

on-demand (group: `spriteframes`)

**8 operations** (`action`): `add_animation`, `remove_animation`, `add_frame`, `remove_frame`, `set_fps`, `set_loop`, `reorder_frames`, `list`

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `action` | enum | yes | Edit operation |
| `animation_name` | string | no | Target animation name |
| `file_path` | string | yes | Path to existing SpriteFrames .tres |
| `fps` | number | no | New FPS value (for set_fps) |
| `frame_index` | integer | no | Frame index (for remove/reorder) |
| `frames` | array | no | Frames to add |
| `loop` | boolean | no | New loop value (for set_loop) |
| `new_index` | integer | no | New position (for reorder) |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:spriteframes_from_spritesheet -->
### `spriteframes_from_spritesheet`

Auto-slice a spritesheet into SpriteFrames animations by grid. Each animation maps to a row/column range in the sheet.

on-demand (group: `spriteframes`) · idempotent

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `animations` | array | yes | Animation definitions mapping to spritesheet regions |
| `file_path` | string | yes | Output .tres file path |
| `frame_size` | object | yes | Size of each frame in the grid |
| `texture_path` | string | yes | Spritesheet texture path (res://) |

<!-- examples:start -->
<!-- examples:end -->

## Group: particles

Create and configure GPU particle systems for visual effects

_1 tool, 1 operations._

<!-- tool:particles_create -->
### `particles_create`

Create GPU particle system (2D/3D) with presets: fire, smoke, sparks, rain, snow, explosion, magic, dust. Inline color_ramp/scale_curve/alpha_curve. One call replaces 7+ manual steps.

on-demand (group: `particles`)

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `alpha_curve` | union | no | Alpha curve over lifetime |
| `amount` | integer | no | Particle count |
| `angle` | union | no |  |
| `angular_velocity` | union | no |  |
| `color` | object | no | Flat particle color |
| `color_ramp` | union | no | Color gradient over lifetime |
| `damping` | union | no |  |
| `direction` | object | no | Emission direction |
| `emission_box_extents` | object | no | Box emission half-extents |
| `emission_shape` | enum | no | Emission shape |
| `emission_sphere_radius` | number | no |  |
| `explosiveness` | number | no | 0-1, burst factor |
| `gravity` | object | no | Gravity vector |
| `hue_variation` | union | no |  |
| `initial_velocity` | union | no | Initial speed (fixed or {min,max}) |
| `lifetime` | number | no | Particle lifetime (seconds) |
| `local_coords` | boolean | no | Emit in local space |
| `mesh` | enum | no | 3D draw pass mesh |
| `name` | string | no | Node name |
| `one_shot` | boolean | no | Single burst then stop |
| `orbit_velocity` | union | no |  |
| `parent_path` | string | yes | Parent node path |
| `particle_flag_align_y` | boolean | no |  |
| `position` | union | no | Node position |
| `preset` | enum | no | Effect preset (overridable with explicit params) |
| `scale_curve` | union | no | Scale curve over lifetime |
| `scale_range` | union | no | Particle scale |
| `speed_scale` | number | no | Simulation speed |
| `spread` | number | no | Spread angle (degrees, 0-180) |
| `texture_path` | string | no | Particle texture (2D, res:// path) |
| `turbulence_enabled` | boolean | no |  |
| `turbulence_noise_strength` | number | no |  |
| `type` | enum | yes | GPUParticles2D or GPUParticles3D |

<!-- examples:start -->
<!-- examples:end -->

## Group: navigation

Set up navigation regions, meshes, and obstacle avoidance

_1 tool, 5 operations._

<!-- tool:navigation_edit -->
### `navigation_edit`

Edit NavigationRegion2D polygon outlines: set all outlines, add/remove individual outlines, clear, or bake the navigation mesh. Required for AI pathfinding setup.

on-demand (group: `navigation`) · destructive

**5 operations** (`action`): `set`, `add_outline`, `remove_outline`, `clear`, `bake`

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `action` | enum | yes | Polygon operation |
| `index` | integer | no | For 'remove_outline': outline index |
| `node_path` | string | yes | Path to NavigationRegion2D node |
| `outline` | array | no | For 'add_outline': single outline as array of {x,y} points |
| `outlines` | array | no | For 'set': array of outline arrays (each outline = array of {x,y} points) |

<!-- examples:start -->
<!-- examples:end -->

## Group: lsp_code_analysis

GDScript diagnostics, symbols, hover info, and a project-wide compile check via the language server

_4 tools, 4 operations._

<!-- tool:lsp_diagnostics -->
### `lsp_diagnostics`

Rich GDScript diagnostics with column positions and severity (Error/Warning/Info/Hint). Needs editor running. Call editor_refresh first if files were just created.

on-demand (group: `lsp_code_analysis`) · read-only · idempotent

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `file_path` | string | yes | Godot resource path (must start with res://, e.g. res://scripts/player.gd). Only .gd and .gdshader — not .cs |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:lsp_symbols -->
### `lsp_symbols`

List all symbols (functions, variables, classes, signals) in a .gd/.gdshader file. Structured tree — cheaper than reading full source.

on-demand (group: `lsp_code_analysis`) · read-only · idempotent

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `file_path` | string | yes | Godot resource path (must start with res://, e.g. res://scripts/player.gd). Only .gd and .gdshader — not .cs |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:lsp_hover -->
### `lsp_hover`

Get type signature and docs for one symbol at a specific position. Use for targeted type checks, not bulk exploration.

on-demand (group: `lsp_code_analysis`) · read-only · idempotent

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `column` | integer | yes | Zero-based column number |
| `file_path` | string | yes | Godot resource path (must start with res://, e.g. res://scripts/player.gd). Only .gd and .gdshader — not .cs |
| `line` | integer | yes | Zero-based line number |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:lsp_project_diagnostics -->
### `lsp_project_diagnostics`

Compile-checks every .gd in the project via the LSP — a guaranteed whole-project compile check. EXPENSIVE (~30s/100+ files; editor may hitch). Use sparingly.

on-demand (group: `lsp_code_analysis`) · read-only · idempotent

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `include_addons` | boolean | no | Also scan res://addons/ (default false; needed when the project's scripts live under addons/). |
| `include_warnings` | boolean | no | Count Warning/Info/Hint diagnostics too (default false = errors only). |

<!-- examples:start -->
<!-- examples:end -->

## Group: lsp_code_navigation

Code completion, go-to-definition, and find references via the language server

_3 tools, 3 operations._

<!-- tool:lsp_completion -->
### `lsp_completion`

Completions at a position. Use limit=5 for targeted queries to save tokens. Only call when you need to discover available API.

on-demand (group: `lsp_code_navigation`) · read-only · idempotent

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `column` | integer | yes | Zero-based column number |
| `file_path` | string | yes | Godot resource path (must start with res://, e.g. res://scripts/player.gd). Only .gd and .gdshader — not .cs |
| `limit` | integer | yes | Max items to return (default 10) |
| `line` | integer | yes | Zero-based line number |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:lsp_definition -->
### `lsp_definition`

Go to definition: file + line where a symbol is defined. One position per call — use only when you need the source location.

on-demand (group: `lsp_code_navigation`) · read-only · idempotent

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `column` | integer | yes | Zero-based column number |
| `file_path` | string | yes | Godot resource path (must start with res://, e.g. res://scripts/player.gd). Only .gd and .gdshader — not .cs |
| `line` | integer | yes | Zero-based line number |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:lsp_references -->
### `lsp_references`

Find all references to a symbol across the project. Use before renaming/removing to assess impact. One symbol per call.

on-demand (group: `lsp_code_navigation`) · read-only · idempotent

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `column` | integer | yes | Zero-based column number |
| `file_path` | string | yes | Godot resource path (must start with res://, e.g. res://scripts/player.gd). Only .gd and .gdshader — not .cs |
| `line` | integer | yes | Zero-based line number |

<!-- examples:start -->
<!-- examples:end -->

## Group: debugger

Inspect debugger state, manage breakpoints, and control execution flow

_4 tools, 4 operations._

<!-- tool:debug_state -->
### `debug_state`

Check debugger status: is a debug session active, is it paused at a breakpoint, can it be debugged. No params.

on-demand (group: `debugger`) · read-only · idempotent

_1 operation._

_No parameters._

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:debug_list_breakpoints -->
### `debug_list_breakpoints`

List all GDScript breakpoints currently set in the script editor. Returns file paths and line numbers. .gd only.

on-demand (group: `debugger`) · read-only · idempotent

_1 operation._

_No parameters._

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:debug_set_breakpoint -->
### `debug_set_breakpoint`

Set or clear a breakpoint at a specific file and line in the script editor. GDScript (.gd) files only.

on-demand (group: `debugger`) · idempotent

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `enabled` | boolean | no | true to set, false to clear (default true) |
| `file_path` | string | yes | res:// path to a .gd file (e.g. res://scripts/player.gd) |
| `line` | integer | yes | 1-based line number |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:debug_continue -->
### `debug_continue`

Resume execution when the debugger is paused at a breakpoint. Fails if not breaked.

on-demand (group: `debugger`)

_1 operation._

_No parameters._

<!-- examples:start -->
<!-- examples:end -->

## Group: classdb

Search and inspect Godot class hierarchy — properties, methods, signals, inheritance

_2 tools, 2 operations._

<!-- tool:classdb_get_info -->
### `classdb_get_info`

Inspect any Godot class: properties, methods, signals, constants, inheritance. Supports engine + user class_name classes. Paged: returned, total_<section>, has_more. When has_more, page via next_offset until has_more is false. The envelope is per-section (properties, methods, signals, constants); offset and limit apply within each section (limit default 200, clamped above 200).

on-demand (group: `classdb`) · read-only

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `class_name` | string | yes | Engine class (e.g. RigidBody3D) or user-defined class_name. |
| `include_inherited` | boolean | no | Include inherited members (default: false, own class only). |
| `limit` | integer | no | Page size (default per tool); a request above the cap is clamped and limit_clamped is set. |
| `offset` | integer | no | Skip the first N (default 0); pass next_offset back as offset until has_more is false. |
| `sections` | array | no | Which sections to return (default: all). Limit to reduce token cost. |

<!-- examples:start -->
<!-- examples:end -->

<!-- tool:classdb_search -->
### `classdb_search`

Find Godot classes by inheritance and/or name pattern. Returns class list with parent + instantiability. Paged: returned, total_classes, has_more. When has_more, page via next_offset until has_more is false. limit default 200, clamped above 200.

on-demand (group: `classdb`) · read-only

_1 operation._

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `base_class` | string | no | Filter to subclasses of this class. |
| `include_global` | boolean | no | Include user class_name classes (default: true). |
| `instantiable_only` | boolean | no | Exclude abstract classes (default: true). |
| `limit` | integer | no | Page size (default per tool); a request above the cap is clamped and limit_clamped is set. |
| `offset` | integer | no | Skip the first N (default 0); pass next_offset back as offset until has_more is false. |
| `pattern` | string | no | Case-insensitive substring match on class name. |

<!-- examples:start -->
<!-- examples:end -->

