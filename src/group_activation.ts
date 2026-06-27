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
 * Extracted from groups.ts (concern 077, C4). Applies the 081 CQS split:
 * activateOrReportGroup → activateGroup (command) + the existing reportGroupStatus
 * (query), with activateGroupByName / reportGroupStatusByName as the built-in-vs-
 * extension dispatchers. reportGroupStatusByName preserves the fused query's
 * routing (built-in → reportGroupStatus / ext → reportExtGroupStatus, readOnly
 * passed through). Reads extension state only through extension_groups accessors
 * (the maps stay private there — DP-S3). Behavior-preserving.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { Bridge } from "./types.js";
import { GROUPS, allDefs, type GroupDef } from "./group_catalogue.js";
import { loadedGroups } from "./group_state.js";
import {
  activateExtGroup,
  reportExtGroupStatus,
  extensionGroupEntries,
  isExtensionGroupLoaded,
  loadedExtensionGroupNames,
  deactivateExtensionGroup,
} from "./extension_groups.js";
import { createHandler } from "./group_tool_handlers.js";
import { isAllowedInReadOnly, isExcludedByReadOnly } from "./profiles.js";
import { registerToolWrapped } from "./tool_registry.js";
import { removeToolByName } from "./tool_refs.js";
import type { ToolMeta, GroupResult } from "./tool_meta.js";

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
      createHandler(bridge, def) as (input: Record<string, unknown>) => Promise<import("./types.js").ToolTextResult>,
      { godotMinVersion: def.godotMinVersion, godotMaxVersion: def.godotMaxVersion },
    );
    registered.push(toolName);
  }
  return registered;
}

// ── discover_tools description builder ──────────────────────────────

// I2 waiver: discover_tools description intentionally exceeds the 200-char
// tool-description limit. As the gateway to 30+ hidden tools, discoverability
// is more important than description brevity for this meta-tool.
//
// Strategy D: group name + one-line description + status tag. No tool lists —
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
    const state = loaded ? "LOADED" : "available";

    const entry = `${group.name} [${state}] — ${group.description}`;
    parts.push(entry);
  }

  const extParts: string[] = [];
  for (const [name, ext] of extensionGroupEntries()) {
    if (readOnly) {
      const hasReadOnly = ext.commands.some((c) => isAllowedInReadOnly(c.annotations));
      if (!hasReadOnly) continue;
    }
    const loaded = isExtensionGroupLoaded(name);
    const desc = ext.description || name;
    extParts.push(`${name} [${loaded ? "LOADED" : "available"}] — ${desc}`);
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

// ── Activate / report (the 081 CQS split: command + query) ───────────

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
    return { name: group.name, status: "already_loaded", tools, description: group.description };
  }
  const registered = registerGroupTools(server, bridge, group, readOnly);
  // In read-only mode, if all tools were filtered out, don't waste a group slot.
  if (readOnly && registered.length === 0) {
    return {
      name: group.name,
      status: "available",
      tools: [],
      description: `Group '${group.name}' has no tools available in read-only mode.`,
    };
  }
  loadedGroups.add(group.name);
  return {
    name: group.name,
    status: "activated",
    tools: registered.map((t) => ({ name: t })),
    description: group.description,
  };
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
  if (loadedGroups.has(groupName))
    return { name: groupName, status: "already_loaded", tools, description: group.description };
  return { name: groupName, status: "available", tools, description: group.description };
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
