/**
 * Tool visibility — Standard tools are always available; read-only mode
 * (GODOT_MCP_READ_ONLY=1) filters out mutating tools.
 */

/** 35 standard tools (discover_tools + extensions_refresh added programmatically → 37 total). */
export const STANDARD_TOOLS: readonly string[] = [
  // Scene (5)
  "scene_get_tree",
  "scene_create_node",
  "scene_delete_node",
  "scene_create",
  "scene_open",
  // Node (7) — node_manage, node_groups, autoload_manage promoted from
  // node_management group: dynamic activation unreliable due to Claude Code
  // not processing tools/list_changed notifications (platform limitation).
  "node_get_property",
  "node_set_property",
  "node_get_property_list",
  "node_set_script",
  "node_manage",
  "node_groups",
  "autoload_manage",
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
  // Scene query (1)
  "scene_query",
  // Gated tools — included so they register on Standard when gate is open
  // (prevents the vanishing-tools bug where neither stub nor real tool appears).
  "execute_code",
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
  "scene_create_inherited",
  // Node mutations
  "node_set_property",
  "node_set_script",
  "node_call_method",
  // Script mutations
  "script_write",
  "script_delete",
  // Editor mutations
  "editor_save_scene",
  "editor_refresh",
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
  "execute_code",
  // Settings
  "project_set_setting",
  "layer_names_set",
  // Signals
  "signal_manage",
  "signal_emit",
  // Input map
  "input_map_action",
  "input_map_event",
  // Animation / tilemap / theme
  "animation_keyframe",
  "animationtree_edit",
  "tilemap_set_cells",
  "tileset_create",
  "tileset_edit",
  "theme_edit",
  // Path editing
  "path2d_edit_curve",
  "collision_from_texture",
  // User data
  "save_write",
  "save_delete",
  // Runtime
  "input_simulate",
  "runtime_set_property",
  "animation_player_control",
  // Node management
  "node_manage",
  "node_groups",
  "autoload_manage",
  // 3D tools
  "3d_create_primitive",
  "3d_setup_environment",
  "3d_create_light",
  "3d_create_camera",
  // Procedural resources
  "procedural_edit_gradient",
  "procedural_edit_curve",
  "procedural_edit_noise",
  // Audio
  "audiobus_edit",
  // SpriteFrames
  "spriteframes_create",
  "spriteframes_edit",
  "spriteframes_from_spritesheet",
  // Particles
  "particles_create",
  // Navigation
  "navigation_edit",
  // Debugger
  "debug_set_breakpoint",
  "debug_continue",
]);

/** Whether read-only mode is active. */
export function isReadOnly(): boolean {
  return process.env.GODOT_MCP_READ_ONLY === "1";
}

/**
 * Build the allowed-tool set for initial registration.
 * Standard tools, minus mutating tools when read-only.
 */
export function resolveAllowedTools(readOnly: boolean): Set<string> {
  const names = new Set(STANDARD_TOOLS);
  if (readOnly) {
    for (const name of MUTATING_TOOLS) names.delete(name);
  }
  return names;
}

/** Emit a one-time deprecation warning if legacy env vars are set. */
export function warnDeprecatedEnvVars(): void {
  if (process.env.GODOT_MCP_PROFILE) {
    process.stderr.write(
      "[godot-mcp] GODOT_MCP_PROFILE is deprecated and ignored. " +
        "Use GODOT_MCP_READ_ONLY=1 for restricted access.\n",
    );
  }
  if (process.argv.includes("--lite")) {
    process.stderr.write("[godot-mcp] Warning: --lite is deprecated and ignored. Use GODOT_MCP_READ_ONLY=1 instead.\n");
  }
}
