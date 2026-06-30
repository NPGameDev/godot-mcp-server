# Smoke Coverage Manifest

**Last updated:** 2026-06-14 (41m-quinquies — scene_spatial_map + placeholder generators)
**Server commit:** S:6fa6143 (+ 41m-quinquies; final SHA recorded at bookkeeping)
**Total tools (eagerly-registered):** 33
**Total tools (including on-demand groups):** 110 (33 eager + 77 on-demand) — authoritative via `src/catalogue.ts`; run `godot-mcp-server --tools-count` for the live breakdown
**Meta-tools:** 2 (discover_tools, extensions_refresh — server-side, not in ToolDef arrays)
**Smoke sections:** 47 (sections 01–47)
**Flow suite:** 3 deterministic cross-tool flows (`npm run flows`) — see the "Flow Suite" section at the end of this file

---

## Maintenance

After any smoke update, update this manifest to reflect new coverage:
- Bump the server commit SHA above to the latest included commit.
- Add new tools with their section numbers.
- Mark any new gaps.

This manifest is the server-repo counterpart of the toolkit repo's
`Validations/SWEEP-COVERAGE-MANIFEST.md`. Both are referenced from
the plan repo's CLAUDE.md for cross-repo visibility.

> **Version-parity invariant (hand-maintained — D-#1).** A version-gated built-in
> needs BOTH a toolkit gate (`.with_min_godot_version`) AND a matching
> server-catalogue bound (`ToolDef.godotMinVersion`). The **server bound is
> authoritative for the `UNSUPPORTED` error message** (`"… (connected:
> <maj>.<min>)"`). No automated cross-repo parity check ships for 1.0 — keep the
> two version tables in sync **by hand** whenever you add or change a version-gated
> built-in. Currently exactly one: `scene_close` (toolkit `scene.close`) @ 4.5+.
> Automated guard deferred to PostRelease.

---

## Tool → Smoke Test Matrix

### Scene Management (10 tools)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| scene_get_tree | 02, 06 | ✓ | — | — | — | |
| scene_create_node | 02, 06, 13, 16, 27, 29, 30, 31, 33, 37, 38 | ✓ | ✓ (07: INVALID_CLASS) | ✓ (unique_name; 02: inline properties incl. typed-dict Color + readback) | — | |
| scene_delete_node | 02, 06, 10, 37 | ✓ | — | — | — | |
| scene_create | 08, 10, 14, 33 | ✓ | ✓ (08: ALREADY_EXISTS, INVALID_PATH) | ✓ (if_exists modes) | — | |
| scene_open | 04, 10 | ✓ | ✓ (04: NOT_FOUND) | — | — | |
| scene_close | 01, 04 | ✓ (04, 4.5+) | ✓ (04: PATH_DENIED, NOT_FOUND, EDITED_SCENE last-tab; 4.5+) | — | ✓ (01: godotMinVersion=4.5) | 4.5+ only; §04 happy+guards gated `godotVer>=4.5` (skips on <4.5 — 41m-ter A0); structural in §01 |
| scene_delete | 08 | ✓ | ✓ (08: NOT_FOUND) | — | — | Scene file deletion (distinct from scene_delete_node) |
| scene_instantiate | 10, 47 | ✓ | ✓ (10: PATH_DENIED, INVALID_PATH, NOT_FOUND) | ✓ (as_name, transform, FIX-K auto-rename, owner-set; **47: batch all-success control → count=2, instances=2, failed/hint absent**) | — | Batch partial-failure not assertable via smoke — see §47 note |
| scene_query | 36 | ✓ | ✓ (INVALID_PARAMS: no filters) | ✓ (class_filter, name_pattern, property_filters, limit) | — | |
| scene_create_inherited | 33 | ✓ | ✓ (NOT_FOUND: missing base) | ✓ (auto root name, custom root name, idempotency) | — | |

### Node Property & Method (5 tools)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| node_get_property | 02, 07, 14, 25 | ✓ | ✓ (07: NOT_FOUND) | — | — | |
| node_set_property | 02, 07, 10, 13, 14, 25, 31, 47 | ✓ | ✓ (07: INVALID_PATH, NOT_FOUND; 02: NOT_FOUND struct-component compound contract) | ✓ (Resource dict; **47: batch partial-failure → top-level `failed`+`hint`, + all-success control asserting both absent**) | — | **GAP:** LayerMask coercion, bare res:// guard |
| node_get_property_list | 05, 25 | ✓ | — | — | — | |
| node_set_script | 16 | ✓ | ✓ (LOAD_FAILED, NOT_FOUND) | ✓ (attach, detach, properties) | — | |
| node_call_method | 25 | ✓ | — | — | ✓ (25: C# hint) | Risk communicated via MCP annotations |

### Node Management (3 tools)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| node_manage | 10 | ✓ (rename, reparent, reorder, duplicate) | — | ✓ (all 4 actions) | — | **GAP:** duplicate with properties override |
| node_groups | 10, 47 | ✓ (add, remove, list) | — | ✓ (**47: batch partial-failure → top-level `failed`+`hint` via tolerant predicate on `{status?,error?}` entries, + all-success control asserting both absent**) | — | |
| autoload_manage | 10 | ✓ (register, unregister, list) | — | — | — | **GAP:** DX hint (ProjectSettings restart) |

### Script Management (4 tools)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| script_read | 03, 21, 25 | ✓ | ✓ (03: NOT_FOUND) | ✓ (21: start_line/end_line range; 03: line-window pagination — truncated/next_start_line/total_lines) | — | |
| script_write | 03, 08, 09, 14, 16, 21, 23, 24, 25 | ✓ | — | ✓ (undoable flag) | — | **GAP:** inline diagnostics response, preload hint |
| script_delete | 08, 09, 24, 25 | ✓ | — | — | — | In cleanup group |
| script_check | 24, 25 | ✓ | ✓ (NOT_FOUND, INVALID_PARAMS: .cs) | ✓ (valid/invalid scripts, diagnostics) | — | |

### Editor Core (4 tools)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| editor_save_scene | 04, 07, 10, 14 | ✓ | — | — | — | |
| editor_get_console | 14 | ✓ | ✓ (INVALID_PARAMS) | ✓ (level_filter, text_filter plain+regex, since_id, source=buffer/file) | — | **GAP:** clear_buffer param. ledger #9: total_lines/next_id/truncated. **Editor parse-error capture is 4.5+ only** (Logger); 4.2-4.4 don't file-log editor parse errors → §14 gates the parse-error-filter assertions (#2/#3/#6) to 4.5+. "at:" continuation leveling for captured multi-line errors is toolkit-side + unit-tested (41m-ter A2/A3) |
| editor_screenshot | 04, 18 | ✓ (inline + save_path) | ✓ (18: PATH_DENIED) | — | — | In editor_advanced group |
| editor_refresh | 03, 14, 16, 23 | ✓ | — | — | — | Renamed from editor_reload_scripts (S:6964946) |

### Editor Advanced (2 additional tools)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| editor_wait_for_idle | 15 | ✓ | — | — | — | Used as import helper |
| project_get_settings | 04, 11, 25 | ✓ | — | ✓ (secret filtering) | — | Envelope-wrapped |

### Project Settings (4 tools)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| project_set_setting | 11 | ✓ | ✓ (INVALID_PATH, INVALID_PARAMS) | ✓ (round-trip, previous value) | — | |
| layer_names_set | 28 | ✓ | ✓ (INVALID_PARAMS: invalid category) | ✓ (2d_physics, 2d_render, etc.) | — | |
| layer_names_get | 28 | ✓ | — | — | — | |
| autoload_manage | (see Node Management) | — | — | — | — | Listed above |

### ClassDB Introspection (2 tools)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| classdb_get_info | 23 | ✓ | ✓ (UNKNOWN_CLASS) | ✓ (sections filter, inherited props, offset pagination, global class) | ✓ (next_offset on truncation) | ledger #9: total_<section>/truncated/next_offset |
| classdb_search | 23 | ✓ | ✓ (UNKNOWN_CLASS) | ✓ (base_class, pattern, offset pagination) | — | ledger #9: total_classes (was total)/truncated/next_offset |

### Asset Management (3 tools)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| asset_list | 14, 15 | ✓ | ✓ (14: PATH_DENIED) | ✓ (name_glob, class_filter, extension_filter, max_results) | — | ledger #9: total_assets/truncated (cursor-less) |
| asset_get_dependencies | 14 | ✓ | ✓ (NOT_FOUND) | — | — | In asset_ops group; ledger #9: total_dependencies/truncated (cursor-less) |
| asset_import | 15 | ✓ | ✓ (PATH_DENIED, ALREADY_EXISTS, INVALID_PARAMS) | ✓ (base64, if_exists modes) | — | In asset_ops group |

### Resource Management (3 tools)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| resource_load | 05, 07, 09 | ✓ | ✓ (07: NOT_FOUND; 09: NOT_A_RESOURCE, INVALID_CLASS) | — | — | In resource_io group |
| resource_write | 08, 09, 14 | ✓ | ✓ (09: INVALID_PATH, PATH_DENIED) | ✓ (create/update discrimination, warnings on unknown keys) | — | In resource_io group |
| resource_delete | 08, 09, 10 | ✓ | — | — | — | In cleanup group |

### File & Folder (3 tools)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| file_delete | 15, 26, 32, 33, 35 | ✓ | ✓ (15: PATH_DENIED) | — | — | In cleanup group |
| folder_create | 08 | ✓ | ✓ (08: INVALID_PATH, FOLDER_PROTECTED) | ✓ (auto-dir, nested) | — | |
| folder_delete | 08, 09 | ✓ | ✓ (08: DIR_NOT_EMPTY, FOLDER_PROTECTED) | — | — | In cleanup group |

### Signals (3 tools)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| signal_list | 05, 07, 25 | ✓ | ✓ (07: NOT_FOUND) | — | — | In signals group |
| signal_manage | 05, 07 | ✓ (connect/disconnect) | ✓ (07: NOT_FOUND, INVALID_PARAMS) | ✓ (idempotency: status=returned) | — | **GAP:** method hint assertion |
| signal_emit | 05 | ✓ | — | — | — | In signals group |

### Diff (1 tool)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| scene_diff | 06, 07 | ✓ | — | ✓ (changed vs unchanged) | — | In scene_advanced group |

### Playtest (2 tools)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| game_start | 10 | ✓ | ✓ (ALREADY_PLAYING) | ✓ (wait_for_runtime=false) | — | **GAP:** wait_for_runtime=true, COMPILATION_FAILED, hint |
| game_stop | 10 | ✓ | — | ✓ (was_running=true/false) | — | |

### Runtime (7 tools)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| runtime_screenshot | 17 | ✓ | ✓ (GAME_NOT_RUNNING) | — | — | |
| runtime_get_node_state | 17 | ✓ | ✓ (GAME_NOT_RUNNING) | — | — | In runtime_advanced group |
| debugger_get_log | 17 | ✓ | — | — | — | **GAP:** cache fallback after game stop; file source under a `text_filter` (smoke calls the default buffer source, no filter). ledger #9: total_lines (was total)/truncated (capped tail); 41n-ter-bis #7a: the file source now filters-then-slices, uniform with the buffer source (supersedes the file-path capped-tail `truncated=start>0`) |
| input_simulate | 17 | ✓ | — | — | — | **GAP:** world_position hint |
| animation_player_control | 17 | ✓ | — | — | — | In runtime_advanced group |
| runtime_get_script_vars | 17 | ✓ | — | — | — | |
| runtime_set_property | 17 | ✓ | — | — | — | |
| execute_code | 17 | ✓ | — | — | — | Risk communicated via MCP annotations. **GAP:** context param, load() hint |

### Input Map (2 tools)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| input_map_action | 12 | ✓ | ✓ (INVALID_PARAMS: empty name, built-in UI action) | ✓ (add/remove, idempotency, deadzone) | — | In input_map group |
| input_map_event | 12 | ✓ | ✓ (NOT_FOUND, INVALID_PARAMS: bogus type/keycode) | ✓ (bind/unbind, key/joypad_button, idempotency) | — | In input_map group |

### Animation (4 tools)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| animation_keyframe | 13 | — | ✓ (NOT_FOUND, INVALID_CLASS, INVALID_PARAMS: bare NodePath) | — | — | **GAP:** happy path (add/update/remove) not tested |
| animation_get_keys | 13 | — | ✓ (INVALID_CLASS, NOT_FOUND) | — | — | Guard coverage. Happy-path needs animation setup |
| animationtree_edit | 27 | ✓ | ✓ (NOT_FOUND) | ✓ (set_root, add_node, add_transition, remove_transition, remove_node) | — | 5 mutating sub-ops (list extracted to animationtree_list, ledger #3 CQS split) |
| animationtree_list | 27 | ✓ | ✓ (INVALID_CLASS) | — | — | Read-only structure list (extracted from animationtree_edit, ledger #3). §27 version-aware: node-enum is 4.5+ (nodes>=2 on 4.5+, [] on 4.2-4.4 — `get_node_list` is 4.5; transitions+counts all versions) (41m-ter A4/A5) |

### Tilemap & Tileset (13 tools)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| tilemap_set_cells | 13 | ✓ (clear) | ✓ (NOT_FOUND, INVALID_PARAMS: malformed cell, INVALID_STATE: no tileset) | — | — | In tilemap group. **GAP:** regions param. §13 node version-branched: TileMapLayer 4.3+ / legacy TileMap 4.2 (41m-ter A1) |
| tilemap_read_cells | 13 | ✓ (empty; TileMapLayer 4.3+ / TileMap 4.2) | ✓ (INVALID_CLASS, NOT_FOUND) | ✓ (total_cells/truncated on empty) | — | Redistributed from S43; node version-branched (41m-ter A1); ledger #9: total_cells (was cells_total)/truncated |
| tileset_create | 13, 44 | ✓ | ✓ (missing texture) | — | ✓ (S44: "TileMap") | In tilemap group |
| tileset_add_source | 44 | ✓ | — | — | ✓ ("tilemap.set_cells") | |
| tileset_remove_source | 44 | ✓ | ✓ (NOT_FOUND: invalid source) | — | ✓ ("tilemap.read_cells") | |
| tileset_add_alternative | 44 | ✓ | — | — | ✓ ("tileset.edit_") | new_alternative_id in response |
| tileset_remove_alternative | 44 | ✓ | ✓ (NOT_FOUND: invalid alt) | — | ✓ ("tilemap.read_cells") | |
| tileset_setup_layers | 44 | ✓ | — | ✓ (terrain_sets, custom_data, navigation_layers) | ✓ ("tileset.edit_") | |
| tileset_edit_physics | 44 | ✓ | ✓ (invalid tile → errors array, NOT_FOUND: missing file) | ✓ (none, one_way) | ✓ ("tilemap.set_cells") | |
| tileset_edit_terrain | 44 | ✓ | — | — | ✓ ("tilemap.set_cells") | |
| tileset_edit_navigation | 44 | ✓ | — | ✓ (full polygon) | ✓ ("tilemap.set_cells") | |
| tileset_edit_visuals | 44 | ✓ | — | ✓ (probability) | ✓ ("tilemap.set_cells") | |
| tileset_edit_custom_data | 44 | ✓ | — | ✓ (multiple fields) | ✓ ("tilemap.set_cells") | |

### Theme (1 tool)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| theme_edit | 26 | ✓ | ✓ (INVALID_PARAMS: invalid property_type) | ✓ (color, font_size, stylebox) | — | In theme group |

### Path & Collision (2 tools)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| path2d_edit_curve | 29 | ✓ | ✓ (INVALID_CLASS) | ✓ (set, add, remove; handles in/out) | — | In path_editing group |
| collision_from_texture | 31 | ✓ | ✓ (INVALID_CLASS) | ✓ (simplification) | — | In path_editing group |

### 3D Tools (4 tools)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| 3d_create_primitive | 30 | ✓ | ✓ (INVALID_PARAMS: invalid primitive) | ✓ (box/sphere, materials) | — | In 3d_tools group |
| 3d_setup_environment | 30 | ✓ | — | ✓ (sky, ambient, tonemap) | — | In 3d_tools group |
| 3d_create_light | 30 | ✓ | — | ✓ (directional + shadow) | — | In 3d_tools group |
| 3d_create_camera | 30 | ✓ | — | ✓ (projection, FOV) | — | In 3d_tools group |

### Procedural (3 tools)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| procedural_edit_gradient | 32 | ✓ | — | ✓ (set points/colors) | — | In procedural group |
| procedural_edit_curve | 32 | ✓ | — | ✓ (set points) | — | In procedural group. **GAP:** add_point, remove_point, set_range sub-ops |
| procedural_edit_noise | 32 | ✓ | ✓ (INVALID_PARAMS: invalid noise_type) | ✓ (frequency, noise_type) | — | In procedural group |

### Audio (2 tools)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| audiobus_edit | 34 | ✓ | ✓ (INVALID_PARAMS: Master removal) | ✓ (add_bus, add_effect, remove_bus) | — | In audio group. list extracted to audiobus_list (ledger #3 CQS split). **GAP:** set_volume, remove_effect, move_effect sub-ops |
| audiobus_list | 34 | ✓ | — | — | — | In audio group; read-only bus-layout snapshot (extracted from audiobus_edit, ledger #3) |

### SpriteFrames (3 tools)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| spriteframes_create | 35 | ✓ | ✓ (INVALID_PARAMS: empty animations) | ✓ (fps, loop) | — | In spriteframes group |
| spriteframes_edit | 35 | ✓ (add_animation) | — | — | — | In spriteframes group. **GAP:** add_frame, remove_frame, reorder, set_fps, set_loop sub-ops |
| spriteframes_from_spritesheet | 35 | ✓ | ✓ (NOT_FOUND: missing texture) | ✓ (frame_size, row, frame_count) | — | In spriteframes group |

### Particles (1 tool)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| particles_create | 37 | ✓ | ✓ (INVALID_PARAMS: invalid preset/type, NOT_FOUND: parent) | ✓ (fire, explosion; 2D/3D; mesh) | — | In particles group. **GAP:** rain, snow, sparks, smoke, magic, dust presets |

### Control Layout (1 tool)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| control_set_layout | 43 | ✓ (PRESET_CENTER) | ✓ (INVALID_PARAMS: bad preset, INVALID_CLASS: non-Control) | ✓ (PRESET_FULL_RECT + margins) | — | Redistributed from grab-bag S43 |

### Navigation (1 tool)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| navigation_edit | 38 | ✓ | ✓ (INVALID_CLASS) | ✓ (set outlines, bake) | — | In navigation group. **GAP:** add_outline, remove_outline sub-ops |

### User Scope / Save (4 tools)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| save_write | 20 | ✓ | ✓ (20: PATH_DENIED, INVALID_PATH, INVALID_PARAMS) | — | — | |
| save_read | 20 | ✓ | ✓ (20: oversized max_bytes → INVALID_PARAMS w/ cap) | ✓ (envelope wrapping, truncation, **offset pagination**: 2-window reassemble + next_offset) | — | `offset`/`next_offset`/`total_bytes` paging; cap configurable (`save_read_cap_kb`, server ceiling 4 MB) |
| save_list | 20 | ✓ | — | ✓ (prefix filtering) | — | |
| save_delete | 20 | ✓ | — | — | — | |

### Meta Tools (2 tools)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| discover_tools | 01 (catalogue), 39 | ✓ (catalogue probe) | — | ✓ (dominant-match prune + recall) | — | **Section 39 (now runs in CI mode):** keyword search, group activation, selective reset, over-activation warning, **dominant-match prune/recall (Item C, 41m-sexies)** |
| extensions_refresh | 22 | ✓ (via extensions.list) | — | — | — | |
| *(error contract)* | 22 | — | ✓ (empty file_path) | — | ✓ (error hint) | Bridge round-trip of MCPToolkitError shape (41l-vicies-ter) |
| *(success contract)* | 22 | ✓ (scene.get_tree) | — | — | — | Verifies ADR 0004 success:true at bridge level (hints are server-side via callAndWrap) |

### LSP / Language Intelligence (6 tools — on-demand group)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| lsp_diagnostics | 41 | — | — | — | — | Static checks only (desc, annotations). Live tests use direct LspClient (server-side) |
| lsp_symbols | 41 | ✓ (documentSymbol) | — | — | — | Via direct LspClient |
| lsp_hover | 41 | ✓ (hover) | — | — | — | Via direct LspClient. Null at 0:0 is valid |
| lsp_completion | 41 | ✓ (completion) | — | — | — | Via direct LspClient |
| lsp_definition | 41 | ✓ (definition) | — | — | — | Via direct LspClient. May return null |
| lsp_references | 41 | ✓ (references) | — | — | — | Via direct LspClient. May return null |

> **Limitation:** LSP tools are server-side (LspClient connects to Godot's built-in LSP on port 6005). Bridge-level tests are not possible — the smoke test bridge connects directly to the Godot plugin. Group activation and guard tests validated by unit tests (undecies-quinquies).

### Debugger (4 tools — on-demand group)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| debug_state | 42 | ✓ (active=false) | — | — | — | Reports game-running state |
| debug_set_breakpoint | 42 | ✓ (set + clear cycle) | ✓ (UNSUPPORTED_FILE_TYPE: .cs) | ✓ (enabled=true/false; `enabled` optional in tools/list — structural Check 7, 41m-sexies) | — | Breakpoint lifecycle tested |
| debug_list_breakpoints | 42 | ✓ (verify set + verify clear) | — | — | — | |
| debug_continue | 42 | ✓ (GAME_NOT_RUNNING) | ✓ (NOT_BREAKED) | — | — | |

### Reconnect & Security (meta-sections)

| Topic | Smoke Section | Coverage | Notes |
|---|---|---|---|
| Reconnect | 19 | ✓ (fake server, drop+reconnect, consecutive calls, second cycle) | |
| Security envelope | 18 | ✓ (path traversal, nonce tags) | |
| Response caps | 21 | ✓ (FILE_TOO_LARGE, range reads, limits) | |
| C# compatibility | 25 | ✓ (detection, .cs ops, exports, signals) | Skips if not .NET project |
| Error contract | 07 | ✓ (status discriminator, recovery hints) | |

### Spatial + Placeholder Generation (3 tools — 41m-quinquies)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| scene_spatial_map | 45 | ✓ (2D overlaps / containment / nearest) | ✓ (INVALID_PARAMS: detail, region size) | ✓ (detail brief/normal/full, class, region, radius, subtree, max_nodes truncation) | ✓ (total_nodes on truncation) | eager; read-only; ledger #9: total_nodes (was node_count)/truncated |
| texture_generate | 46 | ✓ (all 7 shapes, class=Texture2D) | ✓ (INVALID_PATH png, PATH_DENIED, INVALID_PARAMS transparent/shape — bridge/direct path; cf. sweep -32602 via server) | ✓ (colour hex/named/[0-1]/[0-255], hollow, label, dim cap, if_exists, **default-path settle: class populated + no warning + elapsed_ms<1000 — Item B, 41m-sexies**) | — | placeholders group |
| sound_generate | 46 | ✓ (all 5 waveforms, class=AudioStreamWAV) | ✓ (INVALID_PATH wav, PATH_DENIED, INVALID_PARAMS waveform — bridge/direct path; cf. sweep -32602) | ✓ (sweep, decay, duration cap, if_exists) | — | placeholders group |

> **runtime_set_property** was demoted eager → `runtime_advanced` group in
> 41m-quinquies; its smoke stays in **section 17 (mode_b)** — `bridge.call` hits the
> toolkit method directly, so MCP grouping does not affect it.

### Batch Partial-Failure Visibility (section 47 — 41n concern-034 category D)

Asserts the additive top-level `failed` (int) + `hint` (String) that the shared
toolkit helper `summarize_batch` (`editor_helpers.gd`, T:eb25de5/T:42e5b87)
adds to a batch response **only when ≥1 entry failed**. The two tools whose
per-entry failure is reachable from the MCP surface — `node_set_property` and
`node_groups` — each get a one-bad-entry case (failed/hint present + correct)
**and** an all-success control (failed/hint **absent** — locks the additive-only
/ byte-identical guarantee). The third results[]-bearing batch site,
`scene_instantiate` (rollup wired in D-C3 / T:7244950, `scene_commands.gd:708`),
gets the **all-success control only**: its single failure path
(`packed.instantiate()==null`) is not triggerable from a valid `.tscn` (all
entries share one already-validated `PackedScene`), so its partial-failure rollup
is pinned at the helper level by the toolkit headless unit `_test_summarize_batch`
— see the table note below.

| Tool Name | Smoke Section | Coverage | Notes |
|---|---|---|---|
| node_set_property (batch) | 47 | ✓ partial-fail (failed=1, hint contains "1 of 2 entries failed" + "inspect results[]") + ✓ all-success control (failed/hint absent) | Bad entry = nonexistent `node_path` → per-entry `{success:false, error:"node not found"}`; predicate counts `success==false` |
| node_groups (batch) | 47 | ✓ partial-fail (failed=1, same hint) + ✓ all-success control (failed/hint absent) | Bad entry = nonexistent `node_path` → per-entry `{error:"node not found"}` with **no `success` key**; exercises the helper's tolerant predicate (no-success + error ⇒ failure) |
| scene_instantiate (batch) | 47 | ✓ all-success control (count=2, instances=2, failed/hint **absent**); partial-fail **not assertable via smoke** | Site-3 rollup **is** wired — D-C3 (T:7244950) added `summarize_batch` to `_batch_instantiate` (`scene_commands.gd:708`). But the only path that increments top-level `failed` is `packed.instantiate()==null` (`scene_commands.gd:625-628`), and all entries share ONE already-validated `PackedScene`, so a per-entry instantiate failure is **not triggerable through the MCP surface** from a valid `.tscn` (a bad scene fails the whole call at LOAD_FAILED/NOT_FOUND before the batch loop; `instance==null` is a defensive/unreachable path). Per-key coerce errors attach as `property_errors[]` to a **succeeding** entry — they do not increment `failed`. The partial-failure rollup is therefore pinned at the helper level by the toolkit headless unit `_test_summarize_batch` (feeds a `{success:false}` shape); smoke covers the **all-success** scene_instantiate batch control end-to-end. |

> **Hint wording (committed source of truth, `editor_helpers.gd` `summarize_batch`):**
> `"%d of %d entries failed — inspect results[] for per-entry .error."`. Assertions
> use substring matches (`"1 of 2 entries failed"` + `"inspect results[]"`) so they
> survive em-dash / trailing-punctuation tweaks.

---

## Critical Gaps (tools with no or minimal smoke coverage)

No critical gaps remain. All tools have at least guard-level coverage.

> **Resolved in 41l-terdecies:** tileset_edit now covered in S13; discover_tools covered
> structurally in S39; debugger_get_log cache covered in S40; LSP tools covered
> in S41 (direct client); debugger tools covered in S42.

---

## Gap Summary

- **Full coverage (happy + guards + params):** 55 tools
- **Partial coverage (missing params or sub-ops):** 18 tools
- **Minimal coverage (guards only, no happy path):** 1 tool (animation_keyframe)
- **No coverage:** 0 tools
- **On-demand group coverage:** LSP (6/6 static, 5/6 live via direct LspClient), Debugger (4/4 via bridge)

---

## Flow Suite (deterministic cross-tool flows — `npm run flows`, added 41m-bis)

The **flow suite** (`test/flows.ts` + `test/flows/`) is the deterministic
counterpart to the LLM **sweep**. It covers the **cross-tool, stateful flows
smoke structurally cannot express** — smoke tests each tool in isolation
(happy/guard/hint, one call at a time). The flow suite shares smoke's harness
(`test/harness.ts` + `test/helpers.ts`; **not** the dispatch raw-WS helpers) so
the per-step report, exit codes, and `--only/--from/--to` come for free. It is
editor-required and **local-only** (no CI mode — see
SMOKE-MAINTENANCE-PROTOCOL.md). Run: `npm run flows` /
`npm run flows:single -- --only N`. See `CONTEXT.md` "Validation vocabulary"
(plan repo) for the Smoke / Flow suite / Sweep glossary.

**Validated (41m-bis, 2026-06-10):** 23/23 GREEN on **both Godot 4.5.0 and
4.2.0** — including the version-gated Flow 01 update-existing branch (4.5 live /
4.2 deferred restart-hint) and the Flow 02 hazard characterisation (4.5
reachable / 4.2 stale; see `Insights/stale-live-instance-method-hazard.md`).

| Flow | File | Covers | Why smoke can't | Version branch |
|---|---|---|---|---|
| 1 — Extension lifecycle | `flows/01_extension_lifecycle.ts` | create→discovered→call / re-entrancy / update-existing / remove→gone (sweep S24) | Smoke §22 "intentionally does not create extension scripts" — the **Finding #1** regression (`extensions.refresh` → `commands:[]`) hid here while smoke passed 437/0 | update-existing: 4.3+ live, 4.2 deferred restart-hint (regression-guards the 41l-tricies-ter REUSE gate) |
| 2 — Hot-reload reachability | `flows/02_hot_reload_reachability.ts` | live-instance method reachability after a script edit; absent-method → `INVALID_METHOD` contract; characterises the stale-live-instance hazard (feeds the research step → 41m-bis-bis) | Edit-then-call-new-method on a live instance is multi-step + cross-state | characterisation logs the per-version A/B/C outcome |
| 3 — Combo chains | `flows/03_combo_chains.ts` | C4 signal persistence across save/reopen; C8 node-management pipeline (duplicate→rename→reparent→groups) (sweep S22) | Smoke §05 checks the connect *hint* only, never the connection surviving save+reopen; the node pipeline chains state across ops | — |

### Dedup triage (decisions #3/#4 — gap-only, never duplicate)

The flow suite covers ONLY what smoke can't. Items deliberately **left in
smoke** (not ported):

- **Single-call regression-watch items** (the bulk of the sweep's ~43 markers):
  coercion type-tags (Resource/ResourceRef/LayerMask/PackedVector2Array),
  param-name guards, error envelopes, field presence (`valid`, `indexed`,
  diagnostics), enum/idempotency — all observable from one tool call → smoke's
  domain. Add new ones to smoke, not flows.
- **S22 combos already sequenced by smoke:** C3 scene build round-trip (§02/
  §08/§10), C6 tilemap paint (§13/§44), C7/C11 script-write→check-without-refresh
  (§24), **C12 folder.delete with open scene tabs** (§09 already exercises the
  open-tab auto-switch).
- **Server-side / non-bridge:** C10/C27 `discover_tools` group activation +
  version-gate visibility (smoke §39 + server unit tests); FIX-C
  split-notification canary (not deterministically reproducible).
- **Game-runtime + C#:** C5 full game lifecycle, S20/S21 runtime/debugger flows
  (need a running game), S23 C# combos (need a .NET editor) — out of the default
  flow run.

### LLM-confirm protocol (report-only / manual — decision #10)

A flow **FAILURE** is not auto-classified. The operator hands the failing
flow/step to a **targeted LLM sweep re-run** (`Validations/tool-sweep.md`,
toolkit) to distinguish a **stale script** (update the flow) from a **real
regression** (fix the code). No auto-invocation from the `.ts` harness (matches
the "interactive tests = separate session" rule).
