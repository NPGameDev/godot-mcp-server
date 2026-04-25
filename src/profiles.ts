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

/** 12 read-only tools for exploration and code review. */
export const MINIMAL_TOOLS: readonly string[] = [
  "scene_get_tree",
  "node_get_property",
  "node_get_property_list",
  "script_read",
  "script_read_range",
  "editor_get_errors",
  "editor_screenshot",
  "editor_get_console",
  "project_get_settings",
  "asset_list",
  "classdb_get_info",
  "classdb_search",
  "script_check",
];

/** 34 standard tools (enable_tool_group is added programmatically). */
export const STANDARD_TOOLS: readonly string[] = [
  // Scene (7)
  "scene_get_tree",
  "scene_create_node",
  "scene_delete_node",
  "scene_create",
  "scene_instantiate",
  "scene_open",
  "scene_diff",
  // Node (4)
  "node_get_property",
  "node_set_property",
  "node_get_property_list",
  "node_set_script",
  // Script (4)
  "script_read",
  "script_write",
  "script_read_range",
  "script_delete",
  // Editor (8)
  "editor_get_errors",
  "editor_save_scene",
  "editor_screenshot",
  "editor_screenshot_node",
  "editor_reload_scripts",
  "editor_get_console",
  "editor_wait_for_idle",
  "project_get_settings",
  // Playtest (2)
  "game_start",
  "game_stop",
  // Assets (5)
  "resource_load",
  "resource_write",
  "folder_create",
  "folder_delete",
  "asset_list",
  // Content (1)
  "tilemap_set_cells",
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
  // User data
  "save_write",
  "save_delete",
  // Runtime
  "input_simulate",
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

/** When true, tools whose godotMinVersion exceeds the connected Godot version are hidden from tools/list. Default: false (show with notes). */
export function hideUnavailable(): boolean {
  return process.env.GODOT_MCP_HIDE_UNAVAILABLE === "1" || process.env.GODOT_MCP_HIDE_UNAVAILABLE === "true";
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
