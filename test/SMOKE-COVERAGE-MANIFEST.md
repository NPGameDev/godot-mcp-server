# Smoke Coverage Manifest

**Last updated:** 2026-07-11 (41o-duodecies — editor/runtime screenshot collapsed-viewport remediation: §01 structural param/code asserts + §13/§17 manual-assist behavioral legs for force_foreground_* + EDITOR_VIEWPORT_UNAVAILABLE/RUNTIME_WINDOW_MINIMIZED)
**Server commit:** S:11d8d0a (41n-quater-septies; superseded by the landing commit recorded at bookkeeping)
**Total tools (eagerly-registered):** 33
**Total tools (including on-demand groups):** 111 (33 eager + 78 on-demand) — authoritative via `src/catalogue.ts`; run `godot-mcp-server --tools-count` for the live breakdown
**Meta-tools:** 2 (discover_tools, extensions_refresh — server-side, not in ToolDef arrays)
**Smoke sections:** 48 (sections 01–48)
**Flow suite:** 4 deterministic cross-tool flows (`npm run flows`) — see the "Flow Suite" section at the end of this file
**Static structural layer:** `test/structural.ts` (the editor-free half of `npm run smoke:ci`) — asserts tool-name/param-schema/group-membership integrity plus catalogue-wide invariants: tool coverage cross-ref (Check 2), reachability (every tool eager or in an on-demand group), successHint canary (Check 5), `enabled`-optionality parity (Check 7), and the scene_query `offset` pagination param (Check 8). Not tied to any single section — it guards the whole catalogue.

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

## Cross-version C# behavioral coverage

The C# (.NET) behavioral tier (`.github/workflows/cross-version.yml`) runs the
**full smoke suite + full flows suite (NO `--skip`)** against the committed mono
fixture on **Godot 4.2–4.7** (was §25-only, `smoke:single --only 25`) — the .NET
tier, driven by the SHARED language-parameterized composite
`.github/actions/cross-version-behavioral` (`language: dotnet`); its section set is
byte-identical to the GDScript tier's and cannot drift (iter 41n-quater-ter). This
workflow now **also** hosts a GDScript-editor tier (`language: gdscript`, 4.2–4.7,
toolkit dogfood via the pinned sibling), so a server opt-in proves the full
GDScript+.NET contract; the toolkit repo's `cross-version.yml` runs the same
two-editor matrix for its own changes ("full behavioral matrix in both repos"
follow-on). §25 stays the sole C#-aware section; the other ~44 run their GDScript
probes while a mono assembly is loaded (interaction insurance). The former `--skip 10,14` + flows
`--skip 2` headless workarounds are **now removed** (`41n-quater-bis`): §10 game.start, §14 console,
and flows §02 are `is_headless`-deterministic — the toolkit guides headless via HEADLESS_UNSUPPORTED
(game.start) / a `headless_hint` (editor.get_console) / the 4.4+ headless stale-instance hint, and the
server asserts each — so the FULL smoke + flows suites run headless, stripped **once** from the shared
composite so both languages un-skip together. **4.2-on-C# now runs too**
(`41n-quater-septies`): its cold class-cache warm-up ports to dotnet in the shared
composite (CWD = the C# fixture; run_units_cold.sh invoked from the pinned toolkit
checkout), so the .NET tier covers **4.2–4.7**. The 4.2 row carries the SAME shared
`--skip 10,14` / flows `--skip 2` as 4.3–4.7 — no 4.2-specific skip (local-validated
smoke 450/0 + flows 19/0 + units 897/0 on 4.2.0-mono). Full local C# coverage remains
the `godot-mcp-dogfood-NET` `csharp-audit` (18/18) + the C# tool sweep, scheduled
routinely.

> **Validation vocabulary (glossary).** **SWEEP** = toolkit, interactive,
> GDScript tool-exercise (`Validations/`, not in CI). **SMOKE** = server, automated,
> WS-behavioral (`test/sections/`, the CI cross-version tier here). Both "exercise
> the tools," but only SMOKE runs in CI.

---

## Tool → Smoke Test Matrix

### Scene Management (10 tools)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| scene_get_tree | 02, 06 | ✓ | — | — | — | |
| scene_create_node | 02, 06, 13, 16, 27, 29, 30, 31, 33, 37, 38 | ✓ | ✓ (07: INVALID_CLASS) | ✓ (unique_name; 02: inline properties incl. typed-dict Color + readback; 02: returned-path warning names ignored properties/unique_name, absent when none passed) | — | |
| scene_delete_node | 02, 06, 10, 37 | ✓ | — | — | — | |
| scene_create | 08, 10, 14, 33 | ✓ | ✓ (08: ALREADY_EXISTS, INVALID_PATH) | ✓ (if_exists modes; 08: root_name override + stem default) | — | |
| scene_open | 04, 10 | ✓ | ✓ (04: NOT_FOUND) | — | — | |
| scene_close | 01, 04 | ✓ (04, 4.5+) | ✓ (04: PATH_DENIED, NOT_FOUND, EDITED_SCENE last-tab; 4.5+) | — | ✓ (01: godotMinVersion=4.5) | 4.5+ only; §04 happy+guards gated `godotVer>=4.5` (skips on <4.5 — 41m-ter A0); structural in §01. **§01 behavioral (41n-duodecies):** the `cleanup` group summary OMITS scene_close on <4.5 and OFFERS it on 4.5+, keyed on `bridge.getGodotVersion()` — advertise==register, the cross-version CI guard (full smoke runs on real 4.2–4.7). Response discloses `unsaved_changes_discarded: <bool>` on 4.7+ (omitted below 4.7); §04 asserts presence/absence per version. destructiveHint=true. |
| scene_delete | 08 | ✓ | ✓ (08: NOT_FOUND) | — | — | Scene file deletion (distinct from scene_delete_node) |
| scene_instantiate | 10, 47 | ✓ | ✓ (10: PATH_DENIED, INVALID_PATH, NOT_FOUND) | ✓ (as_name, transform, FIX-K auto-rename, owner-set; 10: as_name-collision returned-path warning names ignored transform, absent when none passed; **47: batch all-success control → count=2, instances=2, failed/hint absent**) | — | Batch partial-failure not assertable via smoke — see §47 note |
| scene_query | 36 | ✓ | ✓ (INVALID_PARAMS: no filters) | ✓ (class_filter, name_pattern, property_filters, limit, **offset pagination**) | ✓ (next_offset + hint on has_more) | **Paged envelope** (offset/limit/returned/total_matches/has_more/next_offset): §36 builds a 5-node `pagetest` group at limit 2 and asserts the paging invariants — total_matches constant across pages · Σreturned == total_matches · pages disjoint · union == full set · next_offset chain · has_more false only on final page · determinism · past-end empty page · negative-offset floor · limit>200 clamp + limit_clamped · no-match. `count`→`returned` (removed the ambiguous capped-size field); boundary flag is `has_more` (NOT truncated). Structural Check 8 pins the `offset` param. |
| scene_create_inherited | 33 | ✓ | ✓ (NOT_FOUND: missing base) | ✓ (auto root name, custom root name, idempotency) | — | |

### Node Property & Method (5 tools)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| node_get_property | 02, 07, 14, 25 | ✓ | ✓ (07: NOT_FOUND) | — | — | |
| node_set_property | 02, 07, 10, 13, 14, 25, 31, 47 | ✓ | ✓ (07: INVALID_PATH, NOT_FOUND, **cross-family wrong-type → SET_FAILED; convertible value → ADJUSTED success+`warning`, 41o C1/D1**; 02: NOT_FOUND struct-component compound contract) | ✓ (Resource dict; **07: z_index 2.9→2 adjusted warning; 47: batch partial-failure → top-level `failed`+`hint`, + all-success control asserting both absent**) | — | **GAP:** LayerMask coercion, bare res:// guard |
| node_get_property_list | 05, 25 | ✓ | — | — | — | |
| node_set_script | 16 | ✓ | ✓ (LOAD_FAILED, NOT_FOUND) | ✓ (attach, detach, properties) | — | |
| node_call_method | 25 | ✓ | — | — | ✓ (25: C# hint) | Risk communicated via MCP annotations |

### Node Management (3 tools)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| node_manage | 10 | ✓ (rename, reparent, reorder, duplicate) | — | ✓ (all 4 actions) | — | duplicate-with-properties: **soft/uncredited — hard-assert pending** (§10:449–474 regression case, soft `pass`) |
| node_groups | 10, 47 | ✓ (add, remove, list) | — | ✓ (**47: batch partial-failure → top-level `failed`+`hint` via tolerant predicate on `{status?,error?}` entries, + all-success control asserting both absent**) | — | |
| autoload_manage | 10 | ✓ (register, unregister, list) | — | — | — | **GAP:** DX hint (ProjectSettings restart) |

### Script Management (4 tools)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| script_read | 03, 21, 25 | ✓ | ✓ (03: NOT_FOUND) | ✓ (21: start_line/end_line range + returned; 03: line-window pagination — has_more/next_start_line/total_lines/returned per window) | — | ledger #20: has_more (was truncated); returned added (window line count) |
| script_write | 03, 08, 09, 14, 16, 21, 23, 24, 25 | ✓ | — | ✓ (undoable flag) | — | **GAP:** inline diagnostics response, preload hint |
| script_delete | 08, 09, 24, 25 | ✓ | — | — | — | In cleanup group |
| script_check | 24, 25 | ✓ | ✓ (NOT_FOUND, INVALID_PARAMS: .cs) | ✓ (valid/invalid scripts, diagnostics) | — | §24 asserts the version-aware diagnostics shape: error entry carries the real 1-based `line` on 4.5+, `line` key absent on <4.5 (never a fabricated 0), no `col` ever, hint entries never carry `line` — 41n-undecies S6.6 |

### Editor Core (4 tools)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| editor_save_scene | 04, 07, 10, 14 | ✓ | — | — | — | |
| editor_get_console | 14 | ✓ | ✓ (INVALID_PARAMS) | ✓ (level_filter, text_filter plain+regex, since_id, source=buffer/file, clear_buffer) | — | clear_buffer param: **soft/uncredited — hard-assert pending** (§14:557–568 calls clear_buffer=true, accepts unsupported). ledger #20: returned (was count)/total_lines/next_id/has_more (was truncated). **Editor parse-error capture is 4.5+ only** (Logger); 4.2-4.4 don't file-log editor parse errors → §14 gates the parse-error-filter assertions (#2/#3/#6) to 4.5+. "at:" continuation leveling for captured multi-line errors is toolkit-side + unit-tested (41m-ter A2/A3). **Headless:** those capture assertions also self-skip (`&& !headless`); §14 positively asserts the deterministic `headless_hint` (steers to script_check) whenever error capture is requested. **`source=file`:** the logger holds `godot.log` deny-nothing (`_SH_DENYNO`, every version — source-verified), so the reader's `open(READ)` always succeeds. On 4.3+ the CI composite passes `--log-file user://logs/godot.log` (globalizes to the reader's `user://logs/` dir) so §14 requires the real file-read path — **entries on every platform** (incl. the Windows 4.4.0 `get_modified_time=0` case the selection fall-through recovers), keyed on the `SMOKE_EXPECT_FILE_LOG` harness signal. **`LOG_BUSY` is not an engine effect** — it only arises from an external read-denying holder (antivirus/file-sync/backup); guardrail: POSIX `LOG_BUSY` → fail (never POSIX, never the engine, never 4.5+). 4.2 (no `--log-file` flag) + any no-`--log-file` run assert `LOG_UNAVAILABLE`; on the `LOG_UNAVAILABLE`/`LOG_BUSY` branches §14 asserts the **version-gated recovery `hint` FIELD** (`source="buffer"` present IFF 4.5+ — the `error`/`headless_hint` fields mention buffer on every version, so only `hint` discriminates) + (headless) the `headless_hint` steering to `source="buffer"` — 41n-quater-bis; model corrected 41n-undecies-bis-bis |
| editor_screenshot | 01, 04, 13, 18 | ✓ (inline + save_path + node_path) | ✓ (18: PATH_DENIED; 13: NOT_FOUND, INVALID_PARAMS size; 13 manual-assist: EDITOR_VIEWPORT_UNAVAILABLE minimized) | ✓ (node_path, size, **force_foreground_editor** — §01 asserts the param on inputSchema) | ✓ (13 manual-assist: `remediation` switched_main_screen / foregrounded_editor) | In editor_advanced group. §01 (structural, headless/CI): advertises `force_foreground_editor` + `EDITOR_VIEWPORT_UNAVAILABLE` in ErrorCode union. §13 collapsed-viewport legs (auto-heal, minimized→code, force_foreground recover) are **manual-assist** — gated on `MCP_MANUAL_ASSIST=1` (green-skip unattended; positive coverage in toolkit sweep §07) |
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
| classdb_get_info | 23 | ✓ | ✓ (UNKNOWN_CLASS, limit=0 INVALID_PARAMS) | ✓ (sections filter, inherited props, offset pagination, global class, **limit per-section: default 200, over-max clamp+limit_clamped**) | ✓ (next_offset on has_more) | ledger #20: total_<section>/has_more/next_offset/returned; per-section limit (D11) |
| classdb_search | 23 | ✓ | ✓ (UNKNOWN_CLASS, limit=0 INVALID_PARAMS) | ✓ (base_class, pattern, offset pagination, **limit: default 200, over-max clamp+limit_clamped**) | — | ledger #20: total_classes/has_more/next_offset/returned; caller limit (D11) |

### Asset Management (3 tools)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| asset_list | 14, 15 | ✓ | ✓ (14: PATH_DENIED, bogus class_filter, **limit=0 INVALID_PARAMS**) | ✓ (name_glob, class_filter, extension_filter, limit=1 has_more, **over-max limit=5000 clamp+limit_clamped, D8**) | — | ledger #20: returned/total_assets/has_more (cursor-less); over-max limit clamps (D8, was INVALID_PARAMS) |
| asset_get_dependencies | 14 | ✓ | ✓ (NOT_FOUND) | ✓ (returned) | — | In asset_ops group; ledger #20: returned/total_dependencies/has_more (cursor-less) |
| asset_import | 15 | ✓ | ✓ (PATH_DENIED, ALREADY_EXISTS, INVALID_PARAMS) | ✓ (base64, if_exists modes) | — | In asset_ops group |

### Resource Management (3 tools)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| resource_load | 05, 07, 09 | ✓ | ✓ (07: NOT_FOUND; 09: NOT_A_RESOURCE, INVALID_CLASS) | — | — | In resource_io group |
| resource_write | 08, 09, 14 | ✓ | ✓ (09: INVALID_PATH, PATH_DENIED) | ✓ (create/update discrimination, warnings on unknown keys; 09: file-exists path appends warning naming ignored type, absent when none passed) | — | In resource_io group |
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
| game_start | 10, 40 | ✓ | ✓ (ALREADY_PLAYING; **40: COMPILATION_FAILED** guard) | ✓ (wait_for_runtime=false; **10: wait_for_runtime=true hard-asserts runtime_discovery='bridge' + hint suppression**) | — | wait_for_runtime=true + COMPILATION_FAILED now hard-asserted (§10 / §40). **GAP:** hint. **Headless:** §10 and §40 assert HEADLESS_UNSUPPORTED + script_check guidance for every game.start (early guard fires before param validation, so the cache/COMPILATION_FAILED-on-start paths are unreachable; display path unchanged) — 41n-quater-bis |
| game_stop | 10 | ✓ | — | ✓ (was_running=true/false) | — | |

### Runtime (7 tools)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| runtime_screenshot | 01, 17 | ✓ | ✓ (GAME_NOT_RUNNING; 17 manual-assist: RUNTIME_WINDOW_MINIMIZED) | ✓ (**force_foreground_game** — §01 asserts the param on inputSchema) | — | §01 (structural, headless/CI): advertises `force_foreground_game` + `RUNTIME_WINDOW_MINIMIZED` in ErrorCode union. §17 minimized legs (minimized→code, force_foreground recover) are **manual-assist** — gated on `MCP_MANUAL_ASSIST=1` (green-skip unattended; positive coverage in toolkit sweep §20) |
| runtime_get_node_state | 17 | ✓ | ✓ (GAME_NOT_RUNNING) | — | — | In runtime_advanced group |
| debugger_get_log | 17, 40 | ✓ | — | — | — | cache fallback after game stop: **soft/uncredited — hard-assert pending** (§40:74–118 covers post-stop cached-log fallback, `fail` if GAME_NOT_RUNNING; the §17-scoped row under-reported it). file source under a `text_filter` (§17 calls the default buffer source, no filter). ledger #20: returned (was count)/total_lines/has_more (was truncated) (capped tail); 41n-ter-bis #7a: the file source now filters-then-slices, uniform with the buffer source (supersedes the file-path capped-tail `truncated=start>0`) |
| input_simulate | 17 | ✓ (incl. send_text into fixture LineEdit; **17: unknown action → INVALID_PARAMS, 41o C6**) | — | ✓ (send_text event_type: node_path focus, submit, secret) | ✓ (send_text no-focus + bogus-node_path hints; 17: unknown-action names the action) | send_text (41n-sexies): §17 self-launches `test/fixtures/send_text_smoke.tscn` (skips if absent → positive coverage is sweep-owned), asserts text_changed/text_after + secret redaction (no raw-value leak) + submit. 41o C6: action-mode InputMap guard — unregistered action rejected (key/text/click modes unaffected). **GAP:** world_position hint |
| animation_player_control | 17 | ✓ | — | — | — | In runtime_advanced group |
| runtime_get_script_vars | 17 | ✓ | — | — | — | |
| runtime_set_property | 17 | ✓ | ✓ (17: cross-family wrong-type → SET_FAILED, 41o C1) | — | — | 41o C1/D1: shares the editor path's `contract/property_set_check.gd` tri-state detector (dropped/ok/adjusted; adjusted → success+`warning`); scalar/non-colon paths only. Runtime ADJUSTED is unit- + sweep-covered (20.8c); §17 smoke asserts the DROPPED leg |
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
| tilemap_read_cells | 13 | ✓ (empty; TileMapLayer 4.3+ / TileMap 4.2) | ✓ (INVALID_CLASS, NOT_FOUND) | ✓ (total_cells/has_more on empty, returned=0) | — | Redistributed from S43; node version-branched (41m-ter A1); ledger #20: returned (was cell_count)/total_cells/has_more (was truncated) |
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
| collision_from_texture | 31 | ✓ | ✓ (INVALID_CLASS) | ✓ (simplification) | — | In path_editing group (`parent_path` param, renamed from `target_parent`) |

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
| save_read | 20 | ✓ | ✓ (20: oversized max_bytes → INVALID_PARAMS w/ cap) | ✓ (envelope wrapping, truncation, **offset pagination**: 2-window reassemble + next_offset) | — | ledger #20: returned (was bytes_returned)/has_more (was truncated); `offset`/`next_offset`/`total_bytes` paging; cap configurable (`save_read_cap_kb`, server ceiling 4 MB) |
| save_list | 20 | ✓ | — | ✓ (prefix filtering) | — | |
| save_delete | 20 | ✓ | — | — | — | |

### Meta Tools (2 tools)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| discover_tools | 01 (catalogue), 39 | ✓ (catalogue probe) | — | ✓ (dominant-match prune + recall) | — | **Section 39 (now runs in CI mode):** keyword search, group activation, selective reset, over-activation warning, **dominant-match prune/recall (Item C, 41m-sexies)**. **§01 behavioral (41n-duodecies):** group summaries are connected-version-aware — `reportGroupStatusByName("cleanup")` omits scene_close on <4.5 / offers on 4.5+ (advertise==register; the same version predicate drives browse, activate, and the meta description) |
| extensions_refresh | 22 | ✓ (via extensions.list) | — | — | — | |
| *(error contract)* | 22 | — | ✓ (empty file_path) | — | ✓ (error hint) | Bridge round-trip of MCPToolkitError shape (41l-vicies-ter) |
| *(success contract)* | 22 | ✓ (scene.get_tree) | — | — | — | Verifies ADR 0004 success:true at bridge level (hints are server-side via callAndWrap) |

### LSP / Language Intelligence (7 tools — on-demand group)

| Tool Name | Smoke Section | Happy Path | Guard Tests | Param Variations | Hint Assertions | Notes |
|---|---|---|---|---|---|---|
| lsp_diagnostics | 41 | — | — | — | — | Static checks only (desc, annotations). Live tests use direct LspClient (server-side) |
| lsp_symbols | 41 | ✓ (documentSymbol) | — | — | — | Via direct LspClient |
| lsp_hover | 41 | ✓ (hover) | — | — | — | Via direct LspClient. Null at 0:0 is valid |
| lsp_completion | 41 | ✓ (completion) | — | — | — | Via direct LspClient |
| lsp_definition | 41 | ✓ (definition) | — | — | — | Via direct LspClient. May return null |
| lsp_references | 41 | ✓ (references) | — | — | — | Via direct LspClient. May return null |
| lsp_project_diagnostics | 48 | ✓ (project scan invariant) | ✓ (LSP_UNAVAILABLE mute-chunk → skip) | ✓ (include_addons, include_warnings) | — | Via direct LspClient + createLspHandler. Static: desc ≤200, readOnlyHint, LSP_TOOLS. Live gated on real connect (SKIP if unreachable) |

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
| scene_spatial_map | 45 | ✓ (2D overlaps / containment / nearest) | ✓ (INVALID_PARAMS: detail, region size) | ✓ (detail brief/normal/full, class, region, radius, subtree, max_nodes truncation) | ✓ (total_nodes on has_more) | eager; read-only; ledger #20: returned/total_nodes/has_more (was truncated) |
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
- **On-demand group coverage:** LSP (7/7 static, 6/7 live via direct LspClient), Debugger (4/4 via bridge)

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
(Flow 04 postdates that validation — first live run pending, 41n-undecies.)

| Flow | File | Covers | Why smoke can't | Version branch |
|---|---|---|---|---|
| 1 — Extension lifecycle | `flows/01_extension_lifecycle.ts` | create→discovered→call / re-entrancy / update-existing / remove→gone (sweep S24) | Smoke §22 "intentionally does not create extension scripts" — the **Finding #1** regression (`extensions.refresh` → `commands:[]`) hid here while smoke passed 437/0 | update-existing: 4.3+ live, 4.2 deferred restart-hint (regression-guards the 41l-tricies-ter REUSE gate) |
| 2 — Hot-reload reachability | `flows/02_hot_reload_reachability.ts` | live-instance method reachability after a script edit; absent-method → `INVALID_METHOD` contract; characterises the stale-live-instance hazard (feeds the research step → 41m-bis-bis) | Edit-then-call-new-method on a live instance is multi-step + cross-state | characterisation logs the per-version A/B/C/D outcome; **4.4+ headless** is `is_headless`-aware AND timing-tolerant — NodeCache live-reload (4.4+) is an async-scan/idle RACE, so the test accepts REACHABLE (reload landed) OR STALE + the headless re-instantiation hint (4.5/4.6/4.7 deterministically hit stale+hint, keeping the hint covered; 4.4.0 CI observed reachable). `<4.4` stays strict-STALE — un-skips flows §02 (41n-quater-bis) |
| 3 — Combo chains | `flows/03_combo_chains.ts` | C4 signal persistence across save/reopen; C8 node-management pipeline (duplicate→rename→reparent→groups) (sweep S22) | Smoke §05 checks the connect *hint* only, never the connection surviving save+reopen; the node pipeline chains state across ops | — |
| 4 — Non-@tool call_method guard | `flows/04_non_tool_call_method.ts` | non-@tool script on a live editor node: `node.call_method` → null + the cause-naming runtime-first hint; then @tool flip + `editor_refresh` re-call (sweep 3.19) | The null-result hint needs write→create→attach→call state across four tools | timing-tolerant, in-session necessary-condition only: asserts the version-stable hint substring (the remediation tail is version-gated — scene close+reopen on 4.5+ / editor relaunch below); post-flip accepts REACHABLE **or** still-null-with-hint (headless hot-reload re-instantiation is an async race); the GUI min-remediation ladder is owned by the interactive sweep |

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
