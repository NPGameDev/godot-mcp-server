# Changelog

All notable changes to the Godot MCP Server are documented in this file.

This changelog is auto-generated from [Conventional Commits](https://www.conventionalcommits.org/).

## Features

- feat(server): websocket bridge, mcp server, stdio transport, ping tool, smoke harness (`60d7b0e`)
- feat(tools): register scene and node mcp tools (`cd5e05a`)
- feat(tools): register script and editor mcp tools (`00ae6e7`)
- feat(tools): editor_screenshot accepts optional save_path (`70262ca`)
- feat(server): drop ping, shebang postbuild, LICENSE + ATTRIBUTIONS + CLAUDE.md + README refresh (`1f9b040`)
- feat(tools): register tier 1 — script undo note, editor_reload_scripts, scene_open, project_get_settings (`ea79d3c`)
- feat(tools): tier 2 — register runtime_screenshot, runtime_get_node_state, debugger_get_log (mode b) (`cf0a3e0`)
- feat(tools): tier 3 — signals, resource_load, node_get_property_list registrations (`adbb016`)
- feat(tools): tier 3 — input_simulate, animation_player_control, scene_diff, env-gated game_eval (`49ca092`)
- feat(server): exponential-backoff reconnection + in-flight DISCONNECTED rejection (`433d347`)
- feat(server): scene_create/delete + script_delete + --lite + idempotency smoke (`daf3bdc`)
- feat(server): resource + folder tool registrations + shader mentions + smoke (`2d0c55f`)
- feat(server): playtest + scene.instantiate + node.call_method tool registrations + smoke (guards + round-trip + resource-coercion) (`8dbe567`)
- feat(server): content-authoring tool registrations (input_map, animation, tilemap, project_set_setting, editor_screenshot_node) + smoke (`efe443b`)
- feat(server): asset discovery + editor.get_console registrations + editor.get_errors description refresh + smoke (guards + round-trip + console-probe) (`544c626`)
- feat(server): asset.import + editor.wait_for_idle registrations + smoke (base64 round-trip + guards + catalogue 52/29) (`32a1040`)
- feat(server): scene_close ToolDef + smoke probe teardown + catalogue 53/30 (`4aa3c7f`)
- feat(server): node_set_script ToolDef + scene_create_node class description update + smoke + catalogue 54/31 (`4379082`)
- feat(server): file_delete ToolDef + smoke (round-trip + guards + catalogue 55/31) (`900bbf5`)
- feat(server): token-auth handshake on bridge connect (`1817bef`)
- feat(server): FeatureGate helper + registration-time filtering of gated tools (`cd74838`)
- feat(server): save.* tool registrations + conditional smoke (gate-off catalogue filter + gate-on round-trip + whitelist enforcement) (`26f55d5`)
- feat(server): 256 KB response cap + script_read_range tool (`1d8e410`)
- feat(server): iter 22 — profiles, lazy groups, stubs, schema minification, tool merges (`e639387`)
- feat(server): project-path-keyed bridge discovery via registry (editor + runtime ports) (`250c902`)
- feat(server): per-worktree bridge discovery via absolute-path hash (`81223a5`)
- feat(server): MCP Prompts/Resources/Roots + hooks middleware pipeline (`8004337`)
- feat(server): classdb_get_info tool (lite) + smoke + catalogue 48/16 (`0c37e4e`)
- feat(server): classdb_search tool (lite) + smoke + catalogue 49/17 (`c420a03`)
- feat(server): script_check tool (lite) + smoke + catalogue 50/18 (`757238b`)

## Bug Fixes

- fix(tools): consume plugin's inline-base64 screenshot; revert smoke ordering (`1ade3bf`)
- fix(server): rename package to @npgamedev/godot-mcp-server (`516eb05`)
- fix(smoke): prevent "Could not save one or more scenes!" popup (`25f452c`)
- fix(server): gate-aware dual-pass smoke runner + iter-18 test alignment (`2f5162c`)
- fix(server): nonce-based untrusted envelope + smoke test updates (`0530646`)
- fix(test): close smoke_deps tab in cleanup + fix flaky last-tab assertion (`1014181`)
- fix(server): re-discover editor port from registry on connection loss (`9e04af6`)
- fix(server): resolve project name from projectPath, not just CWD (`a14ec7f`)
- fix(server): resolve project name from projectPath, not just CWD (`c3d33b8`)
- fix(server): classdb smoke — use ok field from script.write response (`9fff7fa`)
- fix(server): exception handling audit + runtime port reference update (9090 → 6525) (`4c22004`)

## Refactors

- refactor(tools): toolError helper + unified isError response contract across all handlers (`9830648`)
- refactor(server): single-source tier tags replace LITE_CORE; tool modules export register() (`6756bee`)
- refactor(tools): rename schema parameters for LLM discoverability (`b9bb6a3`)
- refactor(server): modular smoke test with named sections + readable variables (`081ebc2`)
- refactor(server): split smoke.ts into 19 section files + shared helpers (`c82f011`)
- refactor(server): remove dead tier field + type, iteration refs, redundant comments; generalize to MCP client (`9bf40b4`)

## Documentation

- docs(server): propagate @npgamedev/godot-mcp-server scoped name to README + CLAUDE + lockfile (`ae9adb5`)

## Chores

- chore(plan): scaffold server repo (npm package shell + empty src/) (`a2fde2c`)
- chore(config): bump to 1.0.0, pin all deps to exact versions, add version script (`8d9d638`)
- chore(config): add ESLint + Prettier with npm lint/format scripts (`047a2c2`)

## Other

- Initial commit (`fdfd51e`)

