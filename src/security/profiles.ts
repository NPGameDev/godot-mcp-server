/**
 * Tool visibility — Standard tools are always available; read-only mode
 * (GODOT_MCP_READ_ONLY=1) filters out mutating tools.
 */

/** 33 standard tools (discover_tools + extensions_refresh added programmatically → 35 total). */
export const STANDARD_TOOLS: readonly string[] = [
  // Scene (5)
  "scene_get_tree",
  "scene_create_node",
  "scene_delete_node",
  "scene_create",
  "scene_open",
  // Node (8) — node_manage, node_groups, autoload_manage promoted from
  // node_management group: dynamic activation via tools/list_changed is not
  // robust across MCP clients; keeping them eager is the stable choice.
  // control_set_layout added as standard (all 3 validation agents needed layout).
  "node_get_property",
  "node_set_property",
  "node_get_property_list",
  "node_set_script",
  "node_manage",
  "node_groups",
  "autoload_manage",
  "control_set_layout",
  // Script (2)
  "script_read",
  "script_write",
  // Editor (4) — editor_screenshot demoted to editor_advanced group;
  // editor_get_errors removed (use editor_get_console with level_filter)
  "editor_save_scene",
  "editor_get_console",
  "project_get_settings",
  "project_set_setting",
  // Playtest (6) — runtime tools promoted from lazy runtime group.
  // runtime_set_property was demoted to the runtime_advanced group in
  // 41m-quinquies; listing it here too is dead (MODULE_ALLOWED subtracts
  // group tools from the eager set), so it is intentionally omitted.
  "game_start",
  "game_stop",
  "runtime_screenshot",
  "input_simulate",
  "runtime_get_script_vars",
  "debugger_get_log",
  // Signals (2) — promoted from signals group: all 3 validation agents
  // independently needed signal wiring.
  "signal_list",
  "signal_manage",
  // Assets (1) — asset_list demoted to asset_ops group (zero observed usage)
  "folder_create",
  // Script diagnostics (1)
  "script_check",
  // Scene query (1)
  "scene_query",
  // Spatial (1) — eager read-only scene layout map (added 41m-quinquies).
  // MUST be listed here: eager registration is gated by STANDARD_TOOLS, NOT by
  // ALL_TOOL_DEFS (which only feeds --tools-count and the static catalogue
  // checks). Omitting it makes the tool counted-but-unregistered — absent from
  // tools/list on every session, with no client-side fix. (Regression: a738182;
  // the test/structural.ts reachability check now guards against recurrence.)
  "scene_spatial_map",
  // High-risk tools — always eagerly registered. Risk communicated
  // via MCP annotations (destructiveHint); agent-side filtering recommended.
  "execute_code",
  "node_call_method",
];

/** Annotation shape used by the read-only predicate. */
type ReadOnlyAnnotations = { readOnlyHint?: boolean; destructiveHint?: boolean };

/**
 * Centralized read-only predicate. A tool is allowed in read-only mode iff
 * its annotations declare readOnlyHint: true. Strict inclusion — unannotated
 * tools default to excluded (safe).
 *
 * Runtime invariant: readOnlyHint + destructiveHint is a contradiction.
 * When detected, log a warning and treat the tool as mutating (never crash).
 */
export function isAllowedInReadOnly(annotations?: ReadOnlyAnnotations): boolean {
  if (!annotations?.readOnlyHint) return false;
  if (annotations.destructiveHint) {
    process.stderr.write(
      "[godot-mcp] WARNING: tool has both readOnlyHint and destructiveHint — treating as mutating\n",
    );
    return false;
  }
  return true;
}

/**
 * Combined read-only check: returns true when a tool should be excluded.
 * Wraps both the mode check and the annotation check into a single call
 * so callers don't repeat `if (readOnly && !isAllowedInReadOnly(...))`.
 */
export function isExcludedByReadOnly(readOnly: boolean, annotations?: ReadOnlyAnnotations): boolean {
  return readOnly && !isAllowedInReadOnly(annotations);
}

/** Whether read-only mode is active. */
export function isReadOnly(): boolean {
  return process.env.GODOT_MCP_READ_ONLY === "1";
}

/**
 * Build the allowed-tool set for initial registration.
 * Returns all standard tools. Read-only filtering happens at point-of-use
 * via isAllowedInReadOnly() — no pre-computed subtraction needed.
 */
export function resolveAllowedTools(): Set<string> {
  return new Set(STANDARD_TOOLS);
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
