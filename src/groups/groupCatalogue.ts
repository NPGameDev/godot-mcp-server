/**
 * Static group catalogue — the GROUPS array (which group owns which tools +
 * keywords; the 28 defs live one-per-file in src/groups/defs/, assembled in
 * builtinGroups.ts) and its derived index/lookup sets: the allDefs name→ToolDef
 * map, the GROUP_TOOL_NAMES membership set, and the RUNTIME_TOOLS / LSP_TOOLS
 * routing sets. Pure-data leaf — imports the canonical ALL_TOOL_DEFS
 * (catalogue.ts) and nothing else group-internal, so tool-def modules never
 * cycle back here via catalogue.ts.
 */
import type { ToolDef } from "../shared/types.js";
import type { GroupName } from "./groupTypes.js";

// Canonical tool inventory (single source of truth for counting + lookup).
// A leaf module that does NOT import groups.ts, so tool-def modules never
// cycle back here via catalogue.ts.
import { ALL_TOOL_DEFS } from "../registration/catalogue.js";

// Canonical group catalogue — the ordered GROUPS array, assembled from the 28
// per-group data modules (src/groups/defs/*) by builtinGroups.ts. Imported here
// as a local binding (NOT a bare re-export) so the eager derived sets below —
// GROUP_TOOL_NAMES — read it directly. ESM guarantees builtinGroups.ts and its
// 28 group imports fully execute before this module's body runs, so GROUPS is
// fully assembled when those derivations compute.
import { GROUPS } from "./builtinGroups.js";

// Re-export the group type vocabulary (GroupDef, GroupName) so this module's
// public surface stays self-contained for importers. The declarations
// themselves live in the pure-types leaf groupTypes.ts.
export type { GroupDef, GroupName } from "./groupTypes.js";

// ── Group definitions ────────────────────────────────────────────────

// GROUP_NAMES — the canonical group order, DERIVED from GROUPS rather than
// hand-kept, so the value can never drift from the assembly order in
// builtinGroups.ts. ESM-safe: GROUPS is imported (fully assembled) above before
// this module's body runs, exactly like the eager GROUP_TOOL_NAMES derivation
// below. The GroupName[] element type is preserved (GroupDef.name is GroupName)
// — the central GroupName union in groupTypes.ts stays the type SSOT; only this
// value array is derived.
export const GROUP_NAMES: readonly GroupName[] = GROUPS.map((g) => g.name);

// GROUPS is assembled in builtinGroups.ts from the 28 per-group data modules
// (src/groups/defs/*), in canonical order. Imported above as a local binding and
// re-exported here so this module stays the single resolution point for GROUPS.
export { GROUPS };

/** All tool names that belong to groups (for filtering during eager tool registration). */
export const GROUP_TOOL_NAMES = new Set(GROUPS.flatMap((g) => g.tools));

// ── Tool lookup ──────────────────────────────────────────────────────

// Master lookup of every ToolDef by name, derived from the canonical
// ALL_TOOL_DEFS (catalogue.ts) so the lookup can never drift from the
// counted set. Eager const — no cycle, because catalogue.ts does not import
// groups.ts (group-loaded state lives in the leaf groupState.ts). This map
// is a superset of the group tools (it also holds eager-only tools like
// node/playtest); group code only ever looks up names it knows are group
// tools, so the extra entries are inert.
export const allDefs = new Map<string, ToolDef>(ALL_TOOL_DEFS.map((t) => [t.name, t]));

// Tools that route through the runtime (Mode B) bridge rather than the editor
// bridge. runtime_set_property is an on-demand group tool (not eager) but still
// routes via the runtime bridge, so it belongs in this set. The catalogue
// completeness guard requires every runtime-bridge tool to resolve in
// ALL_TOOL_NAMES.
export const RUNTIME_TOOLS = new Set(["runtime_get_node_state", "runtime_set_property", "animation_player_control"]);

// LSP tools — use their own TCP client, not the bridge. The catalogue
// completeness guard requires each to resolve in ALL_TOOL_NAMES.
export const LSP_TOOLS = new Set([
  "lsp_diagnostics",
  "lsp_hover",
  "lsp_completion",
  "lsp_definition",
  "lsp_symbols",
  "lsp_references",
]);
