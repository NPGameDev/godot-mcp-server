/**
 * Group-activation lifecycle — register / activate / report / deactivate /
 * describe the on-demand tool groups behind discover_tools. The COMMAND side
 * (activateGroup / activateGroupByName) registers a group's tools and tracks it
 * in loadedGroups; the QUERY side (reportGroupStatus / reportGroupStatusByName)
 * reports status without mutating; deactivateGroups unloads built-in + extension
 * groups; buildDiscoverToolsDesc renders the catalogue into the discover_tools
 * description. Its sole caller is the residual groups.ts discover_tools
 * orchestrator — a cohesive service module + its caller, not anemic.
 *
 * Reads extension state only through the extensionGroups accessors — the
 * extension maps stay private to that module.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { Bridge } from "../shared/types.js";
import { GROUPS, allDefs, type GroupDef } from "./groupCatalogue.js";
import { loadedGroups } from "./groupState.js";
import {
  activateExtGroup,
  reportExtGroupStatus,
  extensionGroupEntries,
  isExtensionGroupLoaded,
  loadedExtensionGroupNames,
  deactivateExtensionGroup,
} from "./extensionGroups.js";
import { createGroupToolHandler } from "./groupToolHandlers.js";
import { isAllowedInReadOnly, isExcludedByReadOnly } from "../security/profiles.js";
import { registerToolWrapped } from "../registration/toolRegistry.js";
import { removeToolByName } from "../registration/toolRefs.js";
import type { ToolMeta, GroupResult } from "../registration/toolMeta.js";
import { activatedResult, alreadyLoadedResult, availableResult, readOnlyEmptyResult } from "./groupResult.js";

// ── Registration ─────────────────────────────────────────────────────

/**
 * Register a single group's tools dynamically.
 * Removes any LOCKED stubs for those tools first (stub->real swap).
 * Returns the list of newly registered tool names.
 */
export function registerGroupTools(server: McpServer, bridge: Bridge, group: GroupDef, readOnly: boolean): string[] {
  const registered: string[] = [];
  for (const toolName of group.tools) {
    const def = allDefs.get(toolName);
    if (!def) continue;
    if (isExcludedByReadOnly(readOnly, def.annotations)) continue;
    removeToolByName(toolName); // Remove stub if present
    registerToolWrapped(
      server,
      bridge,
      def.name,
      {
        description: def.description,
        inputSchema: def.inputSchema,
        annotations: def.annotations,
      },
      createGroupToolHandler(bridge, def) as (
        input: Record<string, unknown>,
      ) => Promise<import("../shared/types.js").ToolTextResult>,
      { godotMinVersion: def.godotMinVersion, godotMaxVersion: def.godotMaxVersion },
    );
    registered.push(toolName);
  }
  return registered;
}

// ── discover_tools description builder ──────────────────────────────

/**
 * Format one catalogue line for the discover_tools description, shared by the
 * built-in and extension sections: `<name> [LOADED|available] — <desc>`. The
 * loaded-state source and the description source differ per kind, so the caller
 * resolves both and passes them in.
 */
function formatGroupEntry(name: string, loaded: boolean, desc: string): string {
  return `${name} [${loaded ? "LOADED" : "available"}] — ${desc}`;
}

// Deliberately detailed description: as the gateway to 30+ hidden tools,
// discoverability matters more than brevity for this meta-tool.
//
// Format: group name + one-line description + status tag. No tool lists —
// agents see individual tools only after activation or via no-params catalog.
export function buildDiscoverToolsDesc(readOnly: boolean): string {
  const parts: string[] = [];
  for (const group of GROUPS) {
    if (readOnly) {
      const hasReadOnlyTool = group.tools.some((t) => {
        const d = allDefs.get(t);
        return d ? isAllowedInReadOnly(d.annotations) : false;
      });
      if (!hasReadOnlyTool) continue;
    }

    const loaded = loadedGroups.has(group.name);
    parts.push(formatGroupEntry(group.name, loaded, group.description));
  }

  const extParts: string[] = [];
  for (const [name, ext] of extensionGroupEntries()) {
    if (readOnly) {
      const hasReadOnly = ext.commands.some((c) => isAllowedInReadOnly(c.annotations));
      if (!hasReadOnly) continue;
    }
    const loaded = isExtensionGroupLoaded(name);
    const desc = ext.description || name;
    extParts.push(formatGroupEntry(name, loaded, desc));
  }

  let description =
    "Find and activate tool groups by name or domain keyword. " +
    "Activate only the groups needed for your current task (up to ~5) — loading many groups at once floods the tool list and degrades response quality. " +
    "No params → full catalog. reset: true → deactivate ALL groups; reset: ['group_a'] → deactivate only group_a. " +
    "Groups: " +
    parts.join("; ");
  if (extParts.length > 0) {
    description += ". Extensions: " + extParts.join("; ");
  }
  description += ".";
  return description;
}

// ── Group deactivation ──────────────────────────────────────────────

export function deactivateGroups(names: string[] | true, readOnly: boolean): string[] {
  const deactivated: string[] = [];
  const targets = names === true ? [...loadedGroups, ...loadedExtensionGroupNames()] : names;

  for (const groupName of targets) {
    // Built-in group?
    const group = GROUPS.find((g) => g.name === groupName);
    if (group && loadedGroups.has(groupName)) {
      for (const toolName of group.tools) {
        const def = allDefs.get(toolName);
        if (isExcludedByReadOnly(readOnly, def?.annotations)) continue;
        removeToolByName(toolName);
      }
      loadedGroups.delete(groupName);
      deactivated.push(groupName);
      continue;
    }
    // Extension group?
    if (deactivateExtensionGroup(groupName)) {
      deactivated.push(groupName);
    }
  }
  return deactivated;
}

// ── Activate / report (CQS split: command + query) ───────────

/**
 * Activate a built-in group (the COMMAND half of the old fused
 * activateOrReportGroup). Takes a resolved GroupDef and assumes activate intent;
 * idempotent on an already-loaded group; keeps the read-only "don't waste a
 * slot" guard. The caller dispatches built-in vs ext up front (activateGroupByName).
 */
export function activateGroup(server: McpServer, bridge: Bridge, group: GroupDef, readOnly: boolean): GroupResult {
  // In read-only mode, filter tool lists to only show read-only tools.
  const toolNames = readOnly
    ? group.tools.filter((t) => {
        const d = allDefs.get(t);
        return d ? isAllowedInReadOnly(d.annotations) : false;
      })
    : group.tools;
  const tools: ToolMeta[] = toolNames.map((t) => ({ name: t }));

  if (loadedGroups.has(group.name)) {
    return alreadyLoadedResult(group.name, tools, group.description);
  }
  const registered = registerGroupTools(server, bridge, group, readOnly);
  // In read-only mode, if all tools were filtered out, don't waste a group slot.
  if (readOnly && registered.length === 0) {
    return readOnlyEmptyResult(group.name);
  }
  loadedGroups.add(group.name);
  return activatedResult(group.name, registered, group.description);
}

/**
 * Activate a group by name (the activate-side dispatcher): built-in name →
 * activateGroup; otherwise delegate to the extension-group command
 * (activateExtGroup). Replaces the old activateOrReportGroup name-resolution head.
 */
export function activateGroupByName(server: McpServer, bridge: Bridge, name: string, readOnly: boolean): GroupResult {
  const group = GROUPS.find((g) => g.name === name);
  if (!group) return activateExtGroup(server, bridge, name, readOnly);
  return activateGroup(server, bridge, group, readOnly);
}

/** Report a built-in group's status without mutating (the QUERY half). */
export function reportGroupStatus(groupName: string, readOnly: boolean): GroupResult {
  const group = GROUPS.find((g) => g.name === groupName);
  if (!group) return { name: groupName, status: "available", tools: [] };
  // In read-only mode, filter tool lists to only show read-only tools.
  const toolNames = readOnly
    ? group.tools.filter((t) => {
        const d = allDefs.get(t);
        return d ? isAllowedInReadOnly(d.annotations) : false;
      })
    : group.tools;
  const tools: ToolMeta[] = toolNames.map((t) => ({ name: t }));
  if (loadedGroups.has(groupName)) return alreadyLoadedResult(groupName, tools, group.description);
  return availableResult(groupName, tools, group.description);
}

/**
 * Report a group's status by name (the query-side dispatcher). Preserves the
 * fused activateOrReportGroup query dispatch: built-in → reportGroupStatus,
 * extension → reportExtGroupStatus, with readOnly passed through to the ext
 * query (matching the old fused form). Routing ext browse here — rather than to
 * the built-in reportGroupStatus, which returns empty for a non-built-in name —
 * keeps the ext group's real tool list + already_loaded status.
 */
export function reportGroupStatusByName(name: string, readOnly: boolean): GroupResult {
  const group = GROUPS.find((g) => g.name === name);
  if (!group) return reportExtGroupStatus(name, readOnly);
  return reportGroupStatus(name, readOnly);
}
