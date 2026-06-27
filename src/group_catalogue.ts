/**
 * Static group catalogue — the GROUPS array (which group owns which tools +
 * keywords; the 28 defs now live one-per-file in src/groups/, assembled in
 * builtin_groups.ts) and its derived index/lookup sets: the allDefs name→ToolDef
 * map, the GROUP_TOOL_NAMES membership set, and the RUNTIME_TOOLS / LSP_TOOLS
 * routing sets. Pure-data leaf — imports the canonical ALL_TOOL_DEFS
 * (catalogue.ts) and nothing else group-internal, so tool-def modules never
 * cycle back here via catalogue.ts. Extracted from groups.ts (concern 077, C0).
 */
import type { ToolDef } from "./types.js";
import type { GroupName } from "./group_types.js";

// Canonical tool inventory (single source of truth for counting + lookup).
// A leaf module that does NOT import groups.ts, so tool-def modules never
// cycle back here via catalogue.ts.
import { ALL_TOOL_DEFS } from "./catalogue.js";

// Canonical group catalogue — the ordered GROUPS array, assembled from the 28
// per-group data modules (src/groups/*) by builtin_groups.ts (concern 094, C1).
// Imported here as a local binding (NOT a bare re-export) so the eager derived
// sets below — GROUP_TOOL_NAMES — read it directly. ESM guarantees
// builtin_groups.ts and its 28 group imports fully execute before this module's
// body runs, so GROUPS is fully assembled when those derivations compute.
import { GROUPS } from "./builtin_groups.js";

// Re-export the group type vocabulary so group_catalogue.ts's public surface
// stays byte-stable: group_activation.ts imports GroupDef from here, and the
// groups.ts barrel re-exports GroupName from here. The declarations themselves
// now live in the pure-types leaf group_types.ts (concern 094, C0).
export type { GroupDef, GroupName } from "./group_types.js";

// ── Group definitions ────────────────────────────────────────────────

// GROUP_NAMES — the canonical group order, DERIVED from GROUPS (concern 094, C2)
// rather than hand-kept, so the value can never drift from the assembly order in
// builtin_groups.ts (the old literal had silently fallen out of order, ending in
// placeholders instead of classdb). ESM-safe: GROUPS is imported (fully
// assembled) above before this module's body runs, exactly like the eager
// GROUP_TOOL_NAMES derivation below. The GroupName[] element type is preserved
// (GroupDef.name is GroupName) — the central GroupName union in group_types.ts
// stays the type SSOT; only this value array is now derived.
export const GROUP_NAMES: readonly GroupName[] = GROUPS.map((g) => g.name);

// GROUPS is assembled in builtin_groups.ts from the 28 per-group data modules
// (src/groups/*), in canonical order. Imported above as a local binding and
// re-exported here so external importers of ./group_catalogue.js (group_match,
// group_activation, the groups barrel) keep resolving GROUPS from this module.
export { GROUPS };

/** All tool names that belong to groups (for filtering during eager tool registration). */
export const GROUP_TOOL_NAMES = new Set(GROUPS.flatMap((g) => g.tools));

// ── Tool lookup ──────────────────────────────────────────────────────

// Master lookup of every ToolDef by name, derived from the canonical
// ALL_TOOL_DEFS (src/catalogue.ts) so the lookup can never drift from the
// counted set. Eager const — no cycle, because catalogue.ts does not import
// groups.ts (group-loaded state lives in the leaf group_state.ts). This map
// is a superset of the group tools (it also holds eager-only tools like
// node/playtest); group code only ever looks up names it knows are group
// tools, so the extra entries are inert.
export const allDefs = new Map<string, ToolDef>(ALL_TOOL_DEFS.map((t) => [t.name, t]));

// Tools that route through the runtime (Mode B) bridge — the 3 runtime_advanced
// group tools (runtime_set_property demoted from eager → group in 41m-quinquies;
// it still routes via the runtime bridge, so it must live here). The 4 promoted
// tools (runtime_screenshot, input_simulate, runtime_get_script_vars,
// debugger_get_log) are now standard and handled by runtime.ts.
// Exported for the catalogue completeness guard (01_catalogue.ts): every
// runtime-bridge tool must resolve in ALL_TOOL_NAMES.
export const RUNTIME_TOOLS = new Set(["runtime_get_node_state", "runtime_set_property", "animation_player_control"]);

// LSP tools — use their own TCP client, not the bridge.
// Exported for the catalogue completeness guard (01_catalogue.ts).
export const LSP_TOOLS = new Set([
  "lsp_diagnostics",
  "lsp_hover",
  "lsp_completion",
  "lsp_definition",
  "lsp_symbols",
  "lsp_references",
]);
