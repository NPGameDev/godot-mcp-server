/**
 * Profile system — controls which safe tools are visible by default.
 * Three built-in profiles (minimal/standard/full) + custom. Read-only
 * mode (GODOT_MCP_READ_ONLY=1) removes mutating tools from any profile.
 */

export type ProfileName = "minimal" | "standard" | "power_user";

/** Human-facing display labels. Internal identifiers (env var values) stay lowercase. */
export const PROFILE_DISPLAY_NAMES: Record<ProfileName, string> = {
  minimal: "Minimal",
  standard: "Standard",
  power_user: "Power User",
};

/** 10 read-only tools for exploration and code review. */
export const MINIMAL_TOOLS: readonly string[] = [
  "scene_get_tree",
  "node_get_property",
  "node_get_property_list",
  "script_read",
  "editor_get_console",
  "project_get_settings",
  "asset_list",
  "classdb_get_info",
  "classdb_search",
  "script_check",
];

/** 29 standard tools (enable_tool_group + extensions_refresh added programmatically → 31 total). */
export const STANDARD_TOOLS: readonly string[] = [
  // Scene (5)
  "scene_get_tree",
  "scene_create_node",
  "scene_delete_node",
  "scene_create",
  "scene_open",
  // Node (4)
  "node_get_property",
  "node_set_property",
  "node_get_property_list",
  "node_set_script",
  // Script (2)
  "script_read",
  "script_write",
  // Editor (3) — editor_screenshot demoted to editor_advanced group;
  // editor_get_errors removed (use editor_get_console with level_filter)
  "editor_save_scene",
  "editor_get_console",
  "project_get_settings",
  // Playtest (7) — runtime tools promoted from lazy runtime group
  "game_start",
  "game_stop",
  "runtime_screenshot",
  "input_simulate",
  "runtime_get_script_vars",
  "runtime_set_property",
  "debugger_get_log",
  // Assets (2)
  "folder_create",
  "asset_list",
  // ClassDB (2)
  "classdb_get_info",
  "classdb_search",
  // Script diagnostics (1)
  "script_check",
  // Gated tools — included so they register on Standard when gate is open
  // (prevents the vanishing-tools bug where neither stub nor real tool appears).
  "game_eval",
  "node_call_method",
  "project_set_setting",
];

/** Tools that modify state. Subtracted from catalogue when GODOT_MCP_READ_ONLY=1. */
export const MUTATING_TOOLS = new Set([
  // Scene mutations
  "scene_create_node",
  "scene_delete_node",
  "scene_create",
  "scene_delete",
  "scene_instantiate",
  "scene_close",
  // Node mutations
  "node_set_property",
  "node_set_script",
  "node_call_method",
  // Script mutations
  "script_write",
  "script_delete",
  // Editor mutations
  "editor_save_scene",
  "editor_reload_scripts",
  // Resource/folder/file
  "resource_write",
  "resource_delete",
  "folder_create",
  "folder_delete",
  "file_delete",
  "asset_import",
  // Playtest
  "game_start",
  "game_stop",
  "game_eval",
  // Settings
  "project_set_setting",
  // Signals
  "signal_manage",
  "signal_emit",
  // Input map
  "input_map_action",
  "input_map_event",
  // Animation / tilemap
  "animation_keyframe",
  "tilemap_set_cells",
  "tileset_create",
  "tileset_edit",
  // User data
  "save_write",
  "save_delete",
  // Runtime
  "input_simulate",
  "runtime_set_property",
  "animation_player_control",
]);

/** Determine the active profile from env vars + CLI args. */
export function selectedProfile(): ProfileName {
  if (process.argv.includes("--lite")) {
    process.stderr.write("[godot-mcp] Warning: --lite is deprecated. Use GODOT_MCP_PROFILE=minimal instead.\n");
    return "minimal";
  }
  const env = process.env.GODOT_MCP_PROFILE?.toLowerCase();
  // "full" is a backwards-compat alias for "power_user" (existing .mcp.json files).
  if (env === "full" || env === "power_user") return "power_user";
  if (env === "minimal") return "minimal";
  return "standard";
}

/** Whether read-only mode is active. */
export function isReadOnly(): boolean {
  return process.env.GODOT_MCP_READ_ONLY === "1";
}

/**
 * Build the allowed-tool set for initial registration.
 * Returns null for the `power_user` profile (meaning "register everything").
 */
export function resolveAllowedTools(profile: ProfileName, readOnly: boolean): Set<string> | null {
  let names: Set<string> | null;
  switch (profile) {
    case "minimal":
      names = new Set(MINIMAL_TOOLS);
      break;
    case "standard":
      names = new Set(STANDARD_TOOLS);
      break;
    case "power_user":
      names = null; // allow all
      break;
  }
  if (readOnly && names) {
    for (const name of MUTATING_TOOLS) names.delete(name);
  }
  return names;
}
