/**
 * Lazy-load tool groups — specialized workflows loaded on demand via
 * discover_tools. 27 groups, 72 group tools (live: godot-mcp-server --tools-count).
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge } from "./types.js";
import { registerToolWrapped, batchToolRegistration } from "./tool_registry.js";
import { coercedBoolean } from "./schema_coercion.js";
import { enrichGroupResults, type ToolMeta, type GroupResult } from "./tool_meta.js";
import { isAllowedInReadOnly, isExcludedByReadOnly } from "./profiles.js";
import { removeToolByName, updateToolRef, hasToolRef } from "./tool_refs.js";

// Static group catalogue (the GROUPS literal + its derived lookup/index sets)
// and group-loaded state — both leaf modules that do NOT import groups.ts, so
// tool-def modules never cycle back here via catalogue.ts. group_catalogue.ts
// owns allDefs (derived from catalogue.ts's ALL_TOOL_DEFS).
import { GROUPS, allDefs, GROUP_NAMES, type GroupDef } from "./group_catalogue.js";
import { loadedGroups } from "./group_state.js";
// Dynamic extension-group registry (concern 077, C1). The extensionGroups /
// loadedExtensionGroups maps live there (private); the residual reads + mutates
// ext state only through these accessors + the activate/report helpers.
import {
  type ExtensionCmd,
  clearExtensionGroups,
  deactivateExtensionGroup,
  extensionGroupEntries,
  getExtensionGroup,
  isExtensionGroupLoaded,
  loadedExtensionGroupCount,
  loadedExtensionGroupNames,
  activateExtGroup,
  reportExtGroupStatus,
} from "./extension_groups.js";
// Keyword-scoring pipeline (concern 077, C2). findMatchesSingle scores a query
// against built-in + extension groups; capFuzzyResults caps the fuzzy set;
// coerceRequest normalizes the raw request param. The discover_tools handler
// below is the sole caller.
import { findMatchesSingle, capFuzzyResults, coerceRequest } from "./group_match.js";
// Per-tool callback factory (concern 077, C3). createHandler builds the
// registerTool callback for one tool def — signal_emit dual-mode routing,
// editor_screenshot multi-content, LSP tools' own TCP client, and the default
// callAndWrap path. registerGroupTools below is the sole caller.
import { createHandler } from "./group_tool_handlers.js";

// ── Static group catalogue (re-exported from group_catalogue.ts) ─────
// The GROUPS literal + its derived lookup/index sets (allDefs, GROUP_TOOL_NAMES,
// RUNTIME_TOOLS, LSP_TOOLS) moved to the pure-data leaf group_catalogue.ts
// (concern 077, C0). Re-export the externally-consumed surface so importers of
// groups.js stay unchanged. (allDefs / GROUP_NAMES / GroupDef are
// export-but-internal — consumers import those from group_catalogue.js direct.)
export type { GroupName } from "./group_catalogue.js";
export { GROUPS, GROUP_TOOL_NAMES, RUNTIME_TOOLS, LSP_TOOLS } from "./group_catalogue.js";

// ── Extension-group registry (re-exported from extension_groups.ts) ──
// The dynamic extension-group registry + its mutators moved to the near-leaf
// extension_groups.ts (concern 077, C1). Re-export the externally-consumed
// surface so importers of groups.js stay unchanged. (activateExtGroup /
// reportExtGroupStatus / registerExtGroupTools / the read accessors are
// export-but-internal — C-TSM modules import those from extension_groups.js.)
export type { ExtensionCmd } from "./extension_groups.js";
export {
  addExtensionGroup,
  removeExtensionCommand,
  removeExtensionGroup,
  removeUngroupedExtensionTool,
  hasExtensionGroups,
} from "./extension_groups.js";

// ── Keyword matching (re-exported from group_match.ts) ───────────────
// The keyword-scoring pipeline moved to the pure leaf group_match.ts (concern
// 077, C2). Re-export findMatchesSingle — it is consumed externally
// (groups.test.ts, extensions.test.ts, §39 smoke) — so importers of groups.js
// stay unchanged. (capFuzzyResults / coerceRequest are export-but-internal:
// imported above for the discover_tools handler; no barrel entry needed.)
export { findMatchesSingle } from "./group_match.js";

// loadedGroups (session group-load state) + isGroupLoaded() moved to the leaf
// module group_state.ts (imported above) — lets tool-def modules read load
// state without importing groups.ts. resetLoadedGroups() below still clears it.

/** Clear loaded-group tracking (used by config reload). */
export function resetLoadedGroups(): void {
  loadedGroups.clear();
  clearExtensionGroups();
}

// ── Registration ─────────────────────────────────────────────────────

/**
 * Register a single group's tools dynamically.
 * Removes any LOCKED stubs for those tools first (stub->real swap).
 * Returns the list of newly registered tool names.
 */
function registerGroupTools(server: McpServer, bridge: Bridge, group: GroupDef, readOnly: boolean): string[] {
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
function buildDiscoverToolsDesc(readOnly: boolean): string {
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

function deactivateGroups(names: string[] | true, readOnly: boolean): string[] {
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

/**
 * Register the discover_tools meta-tool and its handler.
 * Call this during base registration. Idempotent — if the tool
 * already exists, updates its description in-place (one notification);
 * otherwise registers fresh (also one notification).
 */
export function registerGroupSystem(server: McpServer, bridge: Bridge, readOnly: boolean): void {
  if (hasToolRef("discover_tools")) {
    updateToolRef("discover_tools", { description: buildDiscoverToolsDesc(readOnly) });
    return;
  }
  registerToolWrapped(
    server,
    bridge,
    "discover_tools",
    {
      description: buildDiscoverToolsDesc(readOnly),
      inputSchema: {
        request: z
          .union([z.string(), z.array(z.string())])
          .optional()
          .describe(
            "Names or keywords to find tool groups. Built-in: " + GROUP_NAMES.join(", ") + " (plus extension groups).",
          ),
        activate: z
          .boolean()
          .optional()
          .describe("Auto-activate matching groups. Default true. Set false to browse without loading."),
        include_schemas: coercedBoolean()
          .optional()
          .describe(
            "Include full parameter schemas and annotations in the response. " +
              "Default false. Only needed when you activated a group but the " +
              "new tools are missing from your tool list.",
          ),
        reset: z
          .union([z.boolean(), z.array(z.string())])
          .optional()
          .describe(
            "Deactivate groups. true = reset ALL on-demand groups. " +
              'Array of group names = selectively deactivate only those groups (e.g. reset: ["tilemap", "audio"]). ' +
              "false or omitted = keep current groups active.",
          ),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input: Record<string, unknown>) => {
      const parsed = input as {
        request?: string | string[];
        activate?: boolean;
        include_schemas?: boolean;
        reset?: boolean | string[];
      };
      const activate = parsed.activate !== false;
      const includeSchemas = parsed.include_schemas === true;
      const requestIsEmpty = Array.isArray(parsed.request) && parsed.request.length === 0;

      const groupResults: GroupResult[] = [];
      const deactivated: string[] = [];
      let fuzzyHint: string | undefined;

      batchToolRegistration(server, () => {
        // Phase 1: reset/deactivation (false is a no-op, same as omitting).
        if (parsed.reset !== undefined && parsed.reset !== false) {
          const names = parsed.reset === true ? true : parsed.reset;
          deactivated.push(...deactivateGroups(names, readOnly));
        }

        // Phase 2: process request — exact names activate directly,
        // unrecognized elements trigger fuzzy keyword search.
        // Empty array is treated as "no request" (catalog trigger), not "zero elements".
        if (parsed.request !== undefined && !requestIsEmpty) {
          const elements = coerceRequest(parsed.request);
          const allNames = new Set<string>([
            ...(GROUP_NAMES as readonly string[]),
            ...[...extensionGroupEntries()].map(([name]) => name),
          ]);
          const exactElements: string[] = [];
          const fuzzyElements: string[] = [];

          for (const el of elements) {
            if (allNames.has(el)) exactElements.push(el);
            else fuzzyElements.push(el);
          }

          // Exact matches (uncapped — agent asked for these by name).
          for (const name of exactElements) {
            const result = activateOrReportGroup(server, bridge, name, activate, readOnly);
            result.match = "exact_name";
            groupResults.push(result);
          }

          // Fuzzy matches (capped: 3 per element, 5 total).
          if (fuzzyElements.length > 0) {
            const perKeyword = new Map<string, { name: string; score: number }[]>();
            for (const keyword of fuzzyElements) {
              perKeyword.set(keyword, findMatchesSingle(keyword, readOnly));
            }
            const { selected, additionalCount } = capFuzzyResults(perKeyword);

            for (const name of selected) {
              if (groupResults.some((r) => r.name === name)) continue;
              const result = activateOrReportGroup(server, bridge, name, activate, readOnly);
              result.match = "loose_keyword";
              groupResults.push(result);
            }

            if (additionalCount > 0) {
              fuzzyHint = `${additionalCount} additional group(s) matched but were not activated — refine your request or pass exact group names.`;
            }
          }
        }

        // Update discover_tools description inside the batch so the
        // tools/list_changed notification fires atomically with all
        // registrations (FIX-C).
        updateToolRef("discover_tools", { description: buildDiscoverToolsDesc(readOnly) });
      });

      // No params (or empty array without reset) → full catalog (no activation).
      // Empty array + reset → reset only; hint nudges a follow-up call for the catalog.
      const catalogRequested = parsed.request === undefined || requestIsEmpty;
      const resetActive = parsed.reset !== undefined && parsed.reset !== false;

      if (catalogRequested && !resetActive) {
        for (const group of GROUPS) {
          groupResults.push(reportGroupStatus(group.name, readOnly));
        }
        for (const [name] of extensionGroupEntries()) {
          groupResults.push(reportExtGroupStatus(name));
        }
      }

      if (requestIsEmpty && resetActive && !fuzzyHint) {
        fuzzyHint = "All groups have been reset. Call discover_tools() with no parameters to browse the full catalog.";
      }

      // Post-collection enrichment: replace bare {name} tool objects with
      // full metadata for activated/already_loaded groups.
      const extCmdLookup = new Map<string, ExtensionCmd>();
      for (const [, ext] of extensionGroupEntries()) {
        for (const cmd of ext.commands) extCmdLookup.set(cmd.toolName, cmd);
      }
      enrichGroupResults(groupResults, includeSchemas, allDefs, extCmdLookup);

      // Build response.
      const response: Record<string, unknown> = { success: true, groups: groupResults };

      if (fuzzyHint) response.hint = fuzzyHint;

      if (deactivated.length > 0) {
        response.deactivated = deactivated;
        if (parsed.reset === true) response.reset_all = true;
        const deactivatedTools: string[] = [];
        for (const gName of deactivated) {
          const group = GROUPS.find((g) => g.name === gName);
          if (group) deactivatedTools.push(...group.tools);
          const ext = getExtensionGroup(gName);
          if (ext) deactivatedTools.push(...ext.commands.map((c) => c.toolName));
        }
        if (deactivatedTools.length > 0) response.deactivated_tools = deactivatedTools;
        if (!response.hint) {
          response.hint =
            "Deactivated tools are no longer callable. " +
            "Call discover_tools(request=[...]) to re-activate before using them.";
        }
      }

      // Cumulative >5 warning — checks total loaded groups across all calls.
      const totalLoaded = loadedGroups.size + loadedExtensionGroupCount();
      if (totalLoaded > 5) {
        response.warning =
          `${totalLoaded} groups currently loaded. ` +
          "This adds many tools to your context and may degrade response quality. " +
          "Prefer activating only the groups needed for your current task. " +
          "Use reset to deactivate groups you no longer need.";
      }

      return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
    },
  );
}

/** Activate a built-in or extension group by name, or report status if not activating. */
function activateOrReportGroup(
  server: McpServer,
  bridge: Bridge,
  groupName: string,
  activate: boolean,
  readOnly: boolean,
): GroupResult {
  const group = GROUPS.find((g) => g.name === groupName);
  if (!group) {
    // Not built-in — dispatch to the extension-group command/query (081 split).
    return activate ? activateExtGroup(server, bridge, groupName, readOnly) : reportExtGroupStatus(groupName, readOnly);
  }

  // In read-only mode, filter tool lists to only show read-only tools.
  const toolNames = readOnly
    ? group.tools.filter((t) => {
        const d = allDefs.get(t);
        return d ? isAllowedInReadOnly(d.annotations) : false;
      })
    : group.tools;
  const tools: ToolMeta[] = toolNames.map((t) => ({ name: t }));

  if (loadedGroups.has(groupName)) {
    return { name: groupName, status: "already_loaded", tools, description: group.description };
  }
  if (!activate) {
    return { name: groupName, status: "available", tools, description: group.description };
  }
  const registered = registerGroupTools(server, bridge, group, readOnly);
  // In read-only mode, if all tools were filtered out, don't waste a group slot.
  if (readOnly && registered.length === 0) {
    return {
      name: groupName,
      status: "available",
      tools: [],
      description: `Group '${groupName}' has no tools available in read-only mode.`,
    };
  }
  loadedGroups.add(groupName);
  return {
    name: groupName,
    status: "activated",
    tools: registered.map((t) => ({ name: t })),
    description: group.description,
  };
}

function reportGroupStatus(groupName: string, readOnly: boolean): GroupResult {
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
