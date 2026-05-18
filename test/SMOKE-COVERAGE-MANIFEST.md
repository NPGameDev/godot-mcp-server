# Smoke Coverage Manifest

**Last updated:** 2026-05-16
**Server commit:** S:e0c2426
**Total tools:** 66 (60 from ToolDef arrays + 2 individually-gated + 4 user_scope-gated + discover_tools + extensions_refresh)
**Smoke sections:** 43 (sections 01–43)
**Dual-pass:** Gates OFF (base 37 eagerly-registered) → Gates ON (all 66 accessible)

---

## Maintenance

After any smoke update, update this manifest to reflect new coverage:
- Bump the server commit SHA above to the latest included commit.
- Add new tools with their section numbers.
- Mark any new gaps.

This manifest is the server-repo counterpart of the toolkit repo's
`Validations/SWEEP-COVERAGE-MANIFEST.md`. Both are referenced from
the plan repo's CLAUDE.md for cross-repo visibility.

---

## Tool → Smoke Test Matrix

### Scene Management (7 tools)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| scene_get_tree | 03, 07 | ✓ | — | — | — | |
| scene_create_node | 03, 07, 14, 17, 28, 30, 31, 32, 34, 38, 39 | ✓ | ✓ (08: INVALID_CLASS) | ✓ (unique_name) | — | |
| scene_delete_node | 03, 07, 11, 38 | ✓ | — | — | — | |
| scene_create | 09, 11, 15, 34 | ✓ | ✓ (09: ALREADY_EXISTS, INVALID_PATH) | ✓ (if_exists modes) | — | |
| scene_open | 05, 11 | ✓ | ✓ (05: NOT_FOUND) | — | — | |
| scene_query | 37 | ✓ | ✓ (INVALID_PARAMS: no filters) | ✓ (class_filter, name_pattern, property_filters, limit) | — | |
| scene_create_inherited | 34 | ✓ | ✓ (NOT_FOUND: missing base) | ✓ (auto root name, custom root name, idempotency) | — | |

### Node Property & Method (5 tools)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| node_get_property | 03, 08, 15, 26 | ✓ | ✓ (08: NOT_FOUND) | — | — | |
| node_set_property | 03, 08, 11, 14, 15, 26, 32 | ✓ | ✓ (08: INVALID_PATH, NOT_FOUND) | ✓ (Resource dict) | — | **GAP:** LayerMask coercion, batch mode, bare res:// guard |
| node_get_property_list | 06, 26 | ✓ | — | — | — | |
| node_set_script | 17 | ✓ | ✓ (LOAD_FAILED, NOT_FOUND) | ✓ (attach, detach, properties) | — | |
| node_call_method | 02, 26 | ✓ (gated) | ✓ (02: FEATURE_DISABLED) | — | ✓ (02: risk, how_to_enable; 26: C# hint) | |

### Node Management (3 tools)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| node_manage | 11 | ✓ (rename, reparent, reorder, duplicate) | — | ✓ (all 4 actions) | — | **GAP:** duplicate with properties override |
| node_groups | 11 | ✓ (add, remove, list) | — | — | — | **GAP:** batch mode |
| autoload_manage | 11 | ✓ (register, unregister, list) | — | — | — | **GAP:** DX hint (ProjectSettings restart) |

### Script Management (4 tools)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| script_read | 04, 22, 26 | ✓ | ✓ (04: NOT_FOUND) | ✓ (22: start_line/end_line range) | — | |
| script_write | 04, 09, 10, 15, 17, 22, 24, 25, 26 | ✓ | — | ✓ (undoable flag) | — | **GAP:** inline diagnostics response, preload hint |
| script_delete | 09, 10, 25, 26 | ✓ | — | — | — | In cleanup group |
| script_check | 25, 26 | ✓ | ✓ (NOT_FOUND, INVALID_PARAMS: .cs) | ✓ (valid/invalid scripts, diagnostics) | — | |

### Editor Core (5 tools)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| editor_save_scene | 05, 08, 11, 15 | ✓ | — | — | — | |
| editor_get_console | 15 | ✓ | ✓ (INVALID_PARAMS) | ✓ (level_filter, text_filter plain+regex, since_id) | — | **GAP:** clear_buffer param |
| editor_get_errors | 04, 15 | ✓ | — | — | — | **GAP:** no dedicated guard tests |
| editor_screenshot | 05, 19 | ✓ (inline + save_path) | ✓ (19: PATH_DENIED) | — | — | In editor_advanced group |
| editor_refresh | 04, 15, 17, 24 | ✓ | — | — | — | Renamed from editor_reload_scripts (S:6964946) |

### Editor Advanced (2 additional tools)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| editor_wait_for_idle | 16 | ✓ | — | — | — | Used as import helper |
| project_get_settings | 05, 12, 26 | ✓ | — | ✓ (secret filtering) | — | Envelope-wrapped |

### Project Settings (4 tools)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| project_set_setting | 12 | ✓ | ✓ (FEATURE_DISABLED, INVALID_PATH, INVALID_PARAMS) | ✓ (round-trip, previous value) | — | |
| layer_names_set | 29 | ✓ | ✓ (INVALID_PARAMS: invalid category) | ✓ (2d_physics, 2d_render, etc.) | — | |
| layer_names_get | 29 | ✓ | — | — | — | |
| autoload_manage | (see Node Management) | — | — | — | — | Listed above |

### Asset Management (3 tools)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| asset_list | 15, 16 | ✓ | ✓ (15: PATH_DENIED) | ✓ (name_glob, class_filter, extension_filter, max_results) | — | |
| asset_get_dependencies | 15 | ✓ | ✓ (NOT_FOUND) | — | — | In asset_ops group |
| asset_import | 16 | ✓ | ✓ (PATH_DENIED, ALREADY_EXISTS, INVALID_PARAMS) | ✓ (base64, if_exists modes) | — | In asset_ops group |

### Resource Management (3 tools)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| resource_load | 06, 08, 10 | ✓ | ✓ (08: NOT_FOUND; 10: NOT_A_RESOURCE, INVALID_CLASS) | — | — | In resource_io group |
| resource_write | 09, 10, 15 | ✓ | ✓ (10: INVALID_PATH, PATH_DENIED) | ✓ (create/update discrimination, warnings on unknown keys) | — | In resource_io group |
| resource_delete | 09, 10, 11 | ✓ | — | — | — | In cleanup group |

### File & Folder (3 tools)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| file_delete | 16, 27, 33, 34, 36 | ✓ | ✓ (16: PATH_DENIED) | — | — | In cleanup group |
| folder_create | 09 | ✓ | ✓ (09: INVALID_PATH, FOLDER_PROTECTED) | ✓ (auto-dir, nested) | — | |
| folder_delete | 09, 10 | ✓ | ✓ (09: DIR_NOT_EMPTY, FOLDER_PROTECTED) | — | — | In cleanup group |

### Signals (3 tools)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| signal_list | 06, 08, 26 | ✓ | ✓ (08: NOT_FOUND) | — | — | In signals group |
| signal_manage | 06, 08 | ✓ (connect/disconnect) | ✓ (08: NOT_FOUND, INVALID_PARAMS) | ✓ (idempotency: status=returned) | — | **GAP:** method hint assertion |
| signal_emit | 06 | ✓ | — | — | — | In signals group |

### Diff (1 tool)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| scene_diff | 07, 08 | ✓ | — | ✓ (changed vs unchanged) | — | In scene_advanced group |

### Playtest (2 tools)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| game_start | 11 | ✓ | ✓ (ALREADY_PLAYING) | ✓ (wait_for_runtime=false) | — | **GAP:** wait_for_runtime=true, COMPILATION_FAILED, hint |
| game_stop | 11 | ✓ | — | ✓ (was_running=true/false) | — | |

### Runtime (7 tools)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| runtime_screenshot | 18 | ✓ | ✓ (GAME_NOT_RUNNING) | — | — | |
| runtime_get_node_state | 18 | ✓ | ✓ (GAME_NOT_RUNNING) | — | — | In runtime_advanced group |
| debugger_get_log | 18 | ✓ | — | — | — | **GAP:** cache fallback after game stop |
| input_simulate | 18 | ✓ | — | — | — | **GAP:** world_position hint |
| animation_player_control | 18 | ✓ | — | — | — | In runtime_advanced group |
| runtime_get_script_vars | 18 | ✓ | — | — | — | |
| runtime_set_property | 18 | ✓ | — | — | — | |
| execute_code | 02, 18 | ✓ (gated) | ✓ (02: FEATURE_DISABLED) | — | ✓ (02: risk, how_to_enable) | **GAP:** context param, load() hint |

### Input Map (2 tools)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| input_map_action | 13 | ✓ | ✓ (FEATURE_DISABLED, INVALID_PARAMS: empty name, built-in UI action) | ✓ (add/remove, idempotency, deadzone) | — | In input_map group |
| input_map_event | 13 | ✓ | ✓ (NOT_FOUND, INVALID_PARAMS: bogus type/keycode) | ✓ (bind/unbind, key/joypad_button, idempotency) | — | In input_map group |

### Animation (3 tools)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| animation_keyframe | 14 | — | ✓ (NOT_FOUND, INVALID_CLASS, INVALID_PARAMS: bare NodePath) | — | — | **GAP:** happy path (add/update/remove) not tested |
| animation_get_keys | — | — | — | — | — | **GAP:** no dedicated test |
| animationtree_edit | 28 | ✓ | ✓ (INVALID_CLASS, NOT_FOUND) | ✓ (set_root, add_node, add_transition, remove_transition, remove_node, list) | — | All 6 sub-ops covered |

### Tilemap (3 tools)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| tilemap_set_cells | 14 | ✓ (clear) | ✓ (NOT_FOUND, INVALID_PARAMS: malformed cell, INVALID_STATE: no tileset) | — | — | In tilemap group. **GAP:** regions param |
| tileset_create | 14 | ✓ | ✓ (missing texture) | — | — | In tilemap group |
| tileset_edit | — | — | — | — | — | **GAP:** no smoke test. 8 sub-ops (collision, terrain, navigation, occlusion, custom_data, animation, alternatives, atlas_source) |

### Theme (1 tool)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| theme_edit | 27 | ✓ | ✓ (INVALID_PARAMS: invalid property_type) | ✓ (color, font_size, stylebox) | — | In theme group |

### Path & Collision (2 tools)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| path2d_edit_curve | 30 | ✓ | ✓ (INVALID_CLASS) | ✓ (set, add, remove; handles in/out) | — | In path_editing group |
| collision_from_texture | 32 | ✓ | ✓ (INVALID_CLASS) | ✓ (simplification) | — | In path_editing group |

### 3D Tools (4 tools)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| 3d_create_primitive | 31 | ✓ | ✓ (INVALID_PARAMS: invalid primitive) | ✓ (box/sphere, materials) | — | In 3d_tools group |
| 3d_setup_environment | 31 | ✓ | — | ✓ (sky, ambient, tonemap) | — | In 3d_tools group |
| 3d_create_light | 31 | ✓ | — | ✓ (directional + shadow) | — | In 3d_tools group |
| 3d_create_camera | 31 | ✓ | — | ✓ (projection, FOV) | — | In 3d_tools group |

### Procedural (3 tools)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| procedural_edit_gradient | 33 | ✓ | — | ✓ (set points/colors) | — | In procedural group |
| procedural_edit_curve | 33 | ✓ | — | ✓ (set points) | — | In procedural group. **GAP:** add_point, remove_point, set_range sub-ops |
| procedural_edit_noise | 33 | ✓ | ✓ (INVALID_PARAMS: invalid noise_type) | ✓ (frequency, noise_type) | — | In procedural group |

### Audio (1 tool)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| audiobus_edit | 35 | ✓ | ✓ (INVALID_PARAMS: Master removal) | ✓ (add_bus, add_effect, list, remove_bus) | — | In audio group. **GAP:** set_volume, remove_effect, move_effect sub-ops |

### SpriteFrames (3 tools)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| spriteframes_create | 36 | ✓ | ✓ (INVALID_PARAMS: empty animations) | ✓ (fps, loop) | — | In spriteframes group |
| spriteframes_edit | 36 | ✓ (add_animation) | — | — | — | In spriteframes group. **GAP:** add_frame, remove_frame, reorder, set_fps, set_loop sub-ops |
| spriteframes_from_spritesheet | 36 | ✓ | ✓ (NOT_FOUND: missing texture) | ✓ (frame_size, row, frame_count) | — | In spriteframes group |

### Particles (1 tool)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| particles_create | 38 | ✓ | ✓ (INVALID_PARAMS: invalid preset/type, NOT_FOUND: parent) | ✓ (fire, explosion; 2D/3D; mesh) | — | In particles group. **GAP:** rain, snow, sparks, smoke, magic, dust presets |

### Navigation (1 tool)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| navigation_edit | 39 | ✓ | ✓ (INVALID_CLASS) | ✓ (set outlines, bake) | — | In navigation group. **GAP:** add_outline, remove_outline sub-ops |

### User Scope / Save (4 tools)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| save_write | 02, 21 | ✓ | ✓ (02: FEATURE_DISABLED; 21: USER_SCOPE_DISABLED, USER_PATH_NOT_WHITELISTED, INVALID_PATH) | — | — | Gated (read_user_scope) |
| save_read | 02, 21 | ✓ | ✓ (02: FEATURE_DISABLED) | ✓ (envelope wrapping, truncation) | — | Gated |
| save_list | 02, 21 | ✓ | ✓ (02: FEATURE_DISABLED) | ✓ (prefix filtering) | — | Gated |
| save_delete | 02, 21 | ✓ | ✓ (02: FEATURE_DISABLED) | — | — | Gated |

### Meta Tools (2 tools)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| discover_tools | 01 (catalogue), 40 | ✓ (catalogue probe) | — | — | — | **Section 40:** keyword search, group activation, selective reset, over-activation warning |
| extensions_refresh | 23 | ✓ (via extensions.list) | — | — | — | |

### Reconnect & Security (meta-sections)

| Topic | Smoke Section | Coverage | Notes |
|---|---|---|---|
| Reconnect | 20 | ✓ (fake server, drop+reconnect) | |
| Security envelope | 19 | ✓ (path traversal, nonce tags) | |
| Response caps | 22 | ✓ (FILE_TOO_LARGE, range reads, limits) | |
| C# compatibility | 26 | ✓ (detection, .cs ops, exports, signals) | Skips if not .NET project |
| Error contract | 08 | ✓ (status discriminator, recovery hints) | |

---

## Critical Gaps (tools with no or minimal smoke coverage)

| Tool | Issue | Priority | Resolution |
|---|---|---|---|
| tileset_edit | No smoke test at all (8 sub-ops) | HIGH | Section 13 expansion |
| animation_get_keys | No dedicated test | MEDIUM | Section 13 or 27 expansion |
| discover_tools | Only catalogue probe (no workflow tests) | HIGH | New section 39 |
| debugger_get_log cache | No cache fallback test | HIGH | New section 40 |

---

## Gap Summary

- **Full coverage (happy + guards + params):** 42 tools
- **Partial coverage (missing params or sub-ops):** 18 tools
- **Minimal coverage (guards only, no happy path):** 2 tools (animation_keyframe, editor_get_errors)
- **No coverage:** 2 tools (tileset_edit, animation_get_keys)
- **New sections needed:** 2 (41: discover_tools, 41: crash/log cache)
