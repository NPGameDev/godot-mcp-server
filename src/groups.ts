/**
 * Lazy-load tool groups — specialized workflows loaded on demand via
 * discover_tools. 27 groups, 72 group tools (live: godot-mcp-server --tools-count).
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge } from "./types.js";
import { registerToolWrapped, batchToolRegistration } from "./tool_registry.js";
import { coercedBoolean } from "./schema_coercion.js";
import { enrichGroupResults, type GroupResult } from "./tool_meta.js";
import { updateToolRef, hasToolRef } from "./tool_refs.js";

// Static group catalogue (the GROUPS literal + its derived lookup/index sets)
// and group-loaded state — both leaf modules that do NOT import groups.ts, so
// tool-def modules never cycle back here via catalogue.ts. group_catalogue.ts
// owns allDefs (derived from catalogue.ts's ALL_TOOL_DEFS).
import { GROUPS, allDefs, GROUP_NAMES } from "./group_catalogue.js";
import { loadedGroups } from "./group_state.js";
// Dynamic extension-group registry (concern 077, C1). The extensionGroups /
// loadedExtensionGroups maps live there (private); the residual touches ext
// state only through these accessors (clearExtensionGroups on reset,
// reportExtGroupStatus for the catalog path's ext query). Activation +
// deactivation moved to group_activation.ts (C4).
import {
  type ExtensionCmd,
  clearExtensionGroups,
  extensionGroupEntries,
  getExtensionGroup,
  loadedExtensionGroupCount,
  reportExtGroupStatus,
} from "./extension_groups.js";
// Keyword-scoring pipeline (concern 077, C2). findMatchesSingle scores a query
// against built-in + extension groups; capFuzzyResults caps the fuzzy set;
// coerceRequest normalizes the raw request param. The discover_tools handler
// below is the sole caller.
import { findMatchesSingle, capFuzzyResults, coerceRequest } from "./group_match.js";
// Group-activation lifecycle (concern 077, C4). registerGroupTools, the 081
// command/query split (activateGroupByName / reportGroupStatusByName dispatchers
// over activateGroup / reportGroupStatus), deactivateGroups, and
// buildDiscoverToolsDesc all live there now; the discover_tools handler below
// composes them. reportGroupStatus is used directly by the catalog path;
// reportGroupStatusByName preserves the fused activateOrReportGroup query
// dispatch (built-in vs ext) at the exact/fuzzy call sites.
import {
  activateGroupByName,
  reportGroupStatus,
  reportGroupStatusByName,
  buildDiscoverToolsDesc,
  deactivateGroups,
} from "./group_activation.js";

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
            const result = activate
              ? activateGroupByName(server, bridge, name, readOnly)
              : reportGroupStatusByName(name, readOnly);
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
              const result = activate
                ? activateGroupByName(server, bridge, name, readOnly)
                : reportGroupStatusByName(name, readOnly);
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
