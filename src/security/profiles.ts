/**
 * Tool visibility — eager tools are always registered up front; read-only mode
 * (GODOT_MCP_READ_ONLY=1) filters out mutating tools.
 */

/** 33 eager tools (discover_tools + extensions_refresh added programmatically → 35 total). */
export const EAGER_TOOLS: readonly string[] = [
  // Scene (5)
  "scene_get_tree",
  "scene_create_node",
  "scene_delete_node",
  "scene_create",
  "scene_open",
  // Node (8) — node_manage, node_groups, autoload_manage are eager rather than
  // in the node_management group: dynamic activation via tools/list_changed is
  // not robust across MCP clients, so keeping them eager is the stable choice.
  // control_set_layout is eager too — layout is needed broadly enough that lazy
  // activation isn't worth it.
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
  // Editor (4) — editor_screenshot lives in the editor_advanced group;
  // there is no editor_get_errors (use editor_get_console with level_filter).
  "editor_save_scene",
  "editor_get_console",
  "project_get_settings",
  "project_set_setting",
  // Playtest (6) — these runtime tools are eager, not in the lazy runtime group.
  // runtime_set_property is intentionally NOT listed here: it is a
  // runtime_advanced group tool, and MODULE_ALLOWED subtracts group tools from
  // the eager set, so listing it would be dead.
  "game_start",
  "game_stop",
  "runtime_screenshot",
  "input_simulate",
  "runtime_get_script_vars",
  "debugger_get_log",
  // Signals (2) — eager rather than in the signals group: signal wiring is
  // needed broadly enough to warrant always-on availability.
  "signal_list",
  "signal_manage",
  // Assets (1) — asset_list lives in the asset_ops group, not eager.
  "folder_create",
  // Script diagnostics (1)
  "script_check",
  // Scene query (1)
  "scene_query",
  // Spatial (1) — eager read-only scene layout map. MUST be listed here: eager
  // registration is gated by EAGER_TOOLS, NOT by ALL_TOOL_DEFS (which only feeds
  // --tools-count and the static catalogue checks). Omitting it makes the tool
  // counted-but-unregistered — absent from tools/list on every session, with no
  // client-side fix. The test/structural.ts reachability check guards against
  // recurrence.
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
 * Returns all eager tools. Read-only filtering happens at point-of-use
 * via isAllowedInReadOnly() — no pre-computed subtraction needed.
 */
export function resolveAllowedTools(): Set<string> {
  return new Set(EAGER_TOOLS);
}
