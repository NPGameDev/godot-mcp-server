/**
 * Lazy-load tool groups — specialized workflows loaded on demand via
 * discover_tools. 27 groups, 72 group tools (live: godot-mcp-server --tools-count).
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "./types.js";
import { registerToolWrapped, batchToolRegistration } from "./tool_registry.js";
import { callAndWrap } from "./tool_dispatch.js";
import { coercedBoolean } from "./schema_coercion.js";
import { toolErrorFromPayload, toolErrorFromException } from "./error_contract.js";
import { enrichGroupResults, type ToolMeta, type GroupResult } from "./tool_meta.js";
import { isAllowedInReadOnly, isExcludedByReadOnly } from "./profiles.js";
import { removeToolByName, updateToolRef, hasToolRef } from "./tool_refs.js";
import { buildScreenshotResult } from "./screenshot_response.js";

// Static group catalogue (the GROUPS literal + its derived lookup/index sets)
// and group-loaded state — both leaf modules that do NOT import groups.ts, so
// tool-def modules never cycle back here via catalogue.ts. group_catalogue.ts
// owns allDefs (derived from catalogue.ts's ALL_TOOL_DEFS).
import { GROUPS, allDefs, GROUP_NAMES, RUNTIME_TOOLS, LSP_TOOLS, type GroupDef } from "./group_catalogue.js";
import { loadedGroups } from "./group_state.js";
import { createLspHandler } from "./tools/lsp.js";

// ── Static group catalogue (re-exported from group_catalogue.ts) ─────
// The GROUPS literal + its derived lookup/index sets (allDefs, GROUP_TOOL_NAMES,
// RUNTIME_TOOLS, LSP_TOOLS) moved to the pure-data leaf group_catalogue.ts
// (concern 077, C0). Re-export the externally-consumed surface so importers of
// groups.js stay unchanged. (allDefs / GROUP_NAMES / GroupDef are
// export-but-internal — consumers import those from group_catalogue.js direct.)
export type { GroupName } from "./group_catalogue.js";
export { GROUPS, GROUP_TOOL_NAMES, RUNTIME_TOOLS, LSP_TOOLS } from "./group_catalogue.js";

// loadedGroups (session group-load state) + isGroupLoaded() moved to the leaf
// module group_state.ts (imported above) — lets tool-def modules read load
// state without importing groups.ts. resetLoadedGroups() below still clears it.

/** Clear loaded-group tracking (used by config reload). */
export function resetLoadedGroups(): void {
  loadedGroups.clear();
  extensionGroups.clear();
  loadedExtensionGroups.clear();
}

// ── Extension groups (dynamic, from third-party extensions) ─────────

export interface ExtensionCmd {
  method: string;
  toolName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: Record<string, boolean>;
}

interface ExtensionGroupDef {
  name: string;
  description: string;
  keywords: string[];
  commands: ExtensionCmd[];
}

const extensionGroups = new Map<string, ExtensionGroupDef>();
const loadedExtensionGroups = new Set<string>();

/** Register a deferred extension group (called from discoverExtensions). Deduplicates by method name. */
export function addExtensionGroup(
  name: string,
  description: string,
  commands: ExtensionCmd[],
  keywords?: string[],
): void {
  const existing = extensionGroups.get(name);
  if (existing) {
    for (const cmd of commands) {
      if (!existing.commands.some((c) => c.method === cmd.method)) {
        existing.commands.push(cmd);
      }
    }
    // Merge description if different.
    if (description && description !== existing.description) {
      existing.description = existing.description + "; " + description;
    }
    // Merge keywords without duplicates.
    if (keywords) {
      for (const kw of keywords) {
        if (!existing.keywords.includes(kw)) existing.keywords.push(kw);
      }
    }
  } else {
    extensionGroups.set(name, { name, description, keywords: keywords ?? [], commands });
  }
}

/** Remove a single command from an extension group by method name. Returns true if found. */
export function removeExtensionCommand(method: string): boolean {
  for (const [name, group] of extensionGroups) {
    const idx = group.commands.findIndex((c) => c.method === method);
    if (idx >= 0) {
      const toolName = group.commands[idx].toolName;
      group.commands.splice(idx, 1);
      removeToolByName(toolName);
      // If no commands remain, remove the entire group.
      if (group.commands.length === 0) {
        extensionGroups.delete(name);
        loadedExtensionGroups.delete(name);
      }
      return true;
    }
  }
  return false;
}

/** Remove an entire extension group by name. Unregisters all its tools. */
export function removeExtensionGroup(name: string): boolean {
  const group = extensionGroups.get(name);
  if (!group) return false;
  for (const cmd of group.commands) {
    removeToolByName(cmd.toolName);
  }
  extensionGroups.delete(name);
  loadedExtensionGroups.delete(name);
  return true;
}

/** Remove an ungrouped extension tool by its method-derived tool name. */
export function removeUngroupedExtensionTool(toolName: string): boolean {
  return removeToolByName(toolName);
}

/** Whether any extension groups exist (used to decide if refresh needed). */
export function hasExtensionGroups(): boolean {
  return extensionGroups.size > 0;
}

// ── Special-case handlers ────────────────────────────────────────────
// Tools with non-standard response processing. Each returns a handler
// function matching the registerTool callback signature.

/** signal_emit has dual-mode routing (editor or runtime). */
function handleSignalEmit(bridge: Bridge, def: ToolDef) {
  return async (input: unknown) => {
    const parsed = input as { node_path: string; signal_name: string; args?: unknown[]; mode?: string };
    const mode = parsed.mode ?? "editor";
    const params = { node_path: parsed.node_path, signal_name: parsed.signal_name, args: parsed.args ?? [] };
    return callAndWrap(bridge, def.method, params, { runtime: mode === "runtime" });
  };
}

/** editor_screenshot returns multi-content (image + text metadata). */
function handleEditorScreenshot(bridge: Bridge, def: ToolDef) {
  return async (input: unknown) => {
    try {
      const result = await bridge.call(def.method, input ?? {});
      const err = toolErrorFromPayload(result);
      if (err) return err;
      const obj = result as {
        image_base64?: string;
        mime_type?: string;
        width?: number;
        height?: number;
        bytes?: number;
        path?: string;
      };
      if (!obj?.image_base64) {
        return toolErrorFromPayload({
          success: false,
          code: "EMPTY_CONTENT",
          error:
            "screenshot returned no image bytes — node may lack visual content. Use editor_screenshot for full viewport.",
        })!;
      }
      return buildScreenshotResult(obj.image_base64, obj.mime_type, {
        width: obj.width,
        height: obj.height,
        bytes: obj.bytes,
        path: obj.path,
      });
    } catch (err) {
      return toolErrorFromException(err);
    }
  };
}

// ── Handler dispatch ─────────────────────────────────────────────────

/**
 * Create the handler for a given tool, respecting runtime routing
 * and special-case tools.
 */
function createHandler(bridge: Bridge, def: ToolDef) {
  switch (def.name) {
    case "signal_emit":
      return handleSignalEmit(bridge, def);
    case "editor_screenshot":
      return handleEditorScreenshot(bridge, def);
    default: {
      if (LSP_TOOLS.has(def.name)) {
        const projectPath = process.env.GODOT_MCP_PROJECT_PATH ?? process.cwd();
        return createLspHandler(def.name, projectPath);
      }
      const useRuntime = RUNTIME_TOOLS.has(def.name);
      return (input: unknown) => callAndWrap(bridge, def.method, input, { runtime: useRuntime });
    }
  }
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

// ── Keyword matching ────────────────────────────────────────────────

// Substring matching requires query.length >= 3 to avoid noisy 1-2 char
// matches. Short domain terms ("2d", "3d", "ui", "ai") must be added as
// explicit exact-match keywords in the group definition.
function matchKeywords(query: string, keywords: string[]): number {
  let score = 0;
  for (const kw of keywords) {
    if (query === kw) score += 3;
    else if (query.includes(kw)) score += 2;
    else if (kw.includes(query) && query.length >= 3) score += 1;
  }
  return score;
}

// Recall-biased dominant-match filter (Item C, 41m-sexies). A multi-word query
// substring-matches several unrelated groups' single keywords (+2 each) while
// the intended group scores far higher; admitting those incidental matches
// bloats the tool context. Drop candidates below this fraction of the top score
// — but NEVER hide a valid group (over-activation is the safe failure direction;
// it is clearer for the LLM to receive extra groups and reset them than to have
// a valid group withheld). Safeguards: keep top-1 always, inclusive boundary,
// and exempt exact keyword/tool-name matches.
const DOMINANT_MATCH_RATIO = 0.5;

/**
 * Score a single keyword against all groups, apply the dominant-match filter,
 * and return surviving {name, score} sorted desc. Exported for the §39 smoke
 * assertions (prune + recall-preservation guardrail).
 */
export function findMatchesSingle(keyword: string, readOnly: boolean): { name: string; score: number }[] {
  const q = keyword.toLowerCase();
  const matches: { name: string; score: number; exact: boolean }[] = [];

  for (const group of GROUPS) {
    if (readOnly) {
      const hasReadOnlyTool = group.tools.some((t) => {
        const d = allDefs.get(t);
        return d ? isAllowedInReadOnly(d.annotations) : false;
      });
      if (!hasReadOnlyTool) continue;
    }
    let score = matchKeywords(q, group.keywords);
    let exact = group.keywords.includes(q);
    for (const toolName of group.tools) {
      const norm = toolName.replace(/_/g, " ");
      if (norm.includes(q) && q.length >= 3) score += 1;
      if (toolName === q || norm === q) exact = true;
    }
    if (score > 0) matches.push({ name: group.name, score, exact });
  }

  for (const [name, ext] of extensionGroups) {
    if (readOnly) {
      const hasReadOnly = ext.commands.some((c) => isAllowedInReadOnly(c.annotations));
      if (!hasReadOnly) continue;
    }
    let score = 0;
    let exact = ext.keywords.includes(q);
    if (ext.keywords.length > 0) {
      score += matchKeywords(q, ext.keywords);
    }
    const descTokens = (ext.description || name).toLowerCase().split(/\s+/);
    for (const tok of descTokens) {
      if (q === tok) score += 2;
      else if (tok.includes(q) && q.length >= 3) score += 1;
    }
    for (const cmd of ext.commands) {
      const norm = cmd.toolName.replace(/_/g, " ");
      if (norm.includes(q) && q.length >= 3) score += 1;
      if (cmd.toolName === q || norm === q) exact = true;
    }
    if (score > 0) matches.push({ name, score, exact });
  }

  matches.sort((a, b) => b.score - a.score);

  // Apply the dominant-match filter. matches[0] is the top score (sorted desc).
  // Keep: the top match (i === 0), any exact match (exempt), and anything within
  // DOMINANT_MATCH_RATIO of the top (inclusive >=). Single-keyword queries cluster
  // within 2× so they survive intact; only the multi-word-phrase noise is pruned.
  let kept = matches;
  if (matches.length > 1) {
    const cutoff = matches[0].score * DOMINANT_MATCH_RATIO;
    kept = matches.filter((m, i) => i === 0 || m.exact || m.score >= cutoff);
  }
  return kept.map((m) => ({ name: m.name, score: m.score }));
}

const FUZZY_PER_ELEMENT_CAP = 3;
const FUZZY_TOTAL_CAP = 5;

/**
 * Cap fuzzy results: 3 per keyword, 5 total.
 * Round-robin top-1 per keyword first (each keyword gets representation),
 * then fill remaining slots by score.
 */
function capFuzzyResults(perKeyword: Map<string, { name: string; score: number }[]>): {
  selected: string[];
  additionalCount: number;
} {
  // Per-element cap: keep top-3 per keyword.
  const cappedPerKeyword = new Map<string, { name: string; score: number }[]>();
  for (const [keyword, matches] of perKeyword) {
    cappedPerKeyword.set(keyword, matches.slice(0, FUZZY_PER_ELEMENT_CAP));
  }

  // Collect all unique candidates (for counting truncation).
  const allUnique = new Set<string>();
  for (const matches of perKeyword.values()) {
    for (const m of matches) allUnique.add(m.name);
  }

  // Round 1: top-1 per keyword (round-robin ensures each keyword gets representation).
  const selected = new Set<string>();
  const selectedList: string[] = [];
  for (const [, matches] of cappedPerKeyword) {
    if (selectedList.length >= FUZZY_TOTAL_CAP) break;
    const best = matches.find((m) => !selected.has(m.name));
    if (best) {
      selected.add(best.name);
      selectedList.push(best.name);
    }
  }

  // Round 2: fill remaining from all capped matches by aggregate score.
  const remaining = new Map<string, number>();
  for (const matches of cappedPerKeyword.values()) {
    for (const m of matches) {
      if (selected.has(m.name)) continue;
      remaining.set(m.name, (remaining.get(m.name) ?? 0) + m.score);
    }
  }
  const sorted = [...remaining.entries()].sort((a, b) => b[1] - a[1]);
  for (const [name] of sorted) {
    if (selectedList.length >= FUZZY_TOTAL_CAP) break;
    selected.add(name);
    selectedList.push(name);
  }

  return { selected: selectedList, additionalCount: allUnique.size - selected.size };
}

/** Coerce request param to string[]. Handles stringified JSON arrays. */
function coerceRequest(raw: string | string[]): string[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string" && raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      /* fall through */
    }
  }
  return [raw];
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
  for (const [name, ext] of extensionGroups) {
    if (readOnly) {
      const hasReadOnly = ext.commands.some((c) => isAllowedInReadOnly(c.annotations));
      if (!hasReadOnly) continue;
    }
    const loaded = loadedExtensionGroups.has(name);
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
  const targets = names === true ? [...loadedGroups, ...loadedExtensionGroups] : names;

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
    if (loadedExtensionGroups.has(groupName)) {
      const ext = extensionGroups.get(groupName);
      if (ext) {
        for (const cmd of ext.commands) removeToolByName(cmd.toolName);
      }
      loadedExtensionGroups.delete(groupName);
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
          const allNames = new Set<string>([...(GROUP_NAMES as readonly string[]), ...extensionGroups.keys()]);
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
        for (const [name] of extensionGroups) {
          groupResults.push(reportExtGroupStatus(name));
        }
      }

      if (requestIsEmpty && resetActive && !fuzzyHint) {
        fuzzyHint = "All groups have been reset. Call discover_tools() with no parameters to browse the full catalog.";
      }

      // Post-collection enrichment: replace bare {name} tool objects with
      // full metadata for activated/already_loaded groups.
      const extCmdLookup = new Map<string, ExtensionCmd>();
      for (const [, ext] of extensionGroups) {
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
          const ext = extensionGroups.get(gName);
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
      const totalLoaded = loadedGroups.size + loadedExtensionGroups.size;
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
    // Try extension groups.
    return activateOrReportExtGroup(server, bridge, groupName, activate, readOnly);
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

function activateOrReportExtGroup(
  server: McpServer,
  bridge: Bridge,
  name: string,
  activate: boolean,
  readOnly: boolean = false,
): GroupResult {
  const ext = extensionGroups.get(name);
  if (!ext) {
    return { name, status: "available", tools: [], description: `Unknown group: ${name}` };
  }
  const toolNames = readOnly
    ? ext.commands.filter((c) => isAllowedInReadOnly(c.annotations)).map((c) => c.toolName)
    : ext.commands.map((c) => c.toolName);
  const tools: ToolMeta[] = toolNames.map((t) => ({ name: t }));
  if (loadedExtensionGroups.has(name)) {
    return { name, status: "already_loaded", tools, description: ext.description };
  }
  if (!activate) {
    return { name, status: "available", tools, description: ext.description };
  }
  const registered = registerExtGroupTools(server, bridge, ext, readOnly);
  // In read-only mode, if all tools were filtered out, don't waste a group slot.
  if (readOnly && registered.length === 0) {
    return {
      name,
      status: "available",
      tools: [],
      description: `Group '${name}' has no tools available in read-only mode.`,
    };
  }
  loadedExtensionGroups.add(name);
  return {
    name,
    status: "activated",
    tools: registered.map((t) => ({ name: t })),
    description: ext.description,
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

function reportExtGroupStatus(name: string): GroupResult {
  const ext = extensionGroups.get(name);
  if (!ext) return { name, status: "available", tools: [] };
  const tools: ToolMeta[] = ext.commands.map((c) => ({ name: c.toolName }));
  if (loadedExtensionGroups.has(name)) return { name, status: "already_loaded", tools, description: ext.description };
  return { name, status: "available", tools, description: ext.description };
}

/** Register an extension group's tools (called from discover_tools handler). */
function registerExtGroupTools(
  server: McpServer,
  bridge: Bridge,
  group: ExtensionGroupDef,
  readOnly: boolean = false,
): string[] {
  const registered: string[] = [];
  for (const cmd of group.commands) {
    if (isExcludedByReadOnly(readOnly, cmd.annotations)) continue;
    registerToolWrapped(
      server,
      bridge,
      cmd.toolName,
      {
        description: cmd.description,
        inputSchema: cmd.inputSchema,
        annotations: {
          readOnlyHint: cmd.annotations.readOnlyHint ?? false,
          destructiveHint: cmd.annotations.destructiveHint ?? false,
          idempotentHint: cmd.annotations.idempotentHint ?? false,
        },
      },
      (input: unknown, signal?: AbortSignal) =>
        callAndWrap(bridge, cmd.method, input, { signal }) as Promise<import("./types.js").ToolTextResult>,
    );
    registered.push(cmd.toolName);
  }
  return registered;
}

/**
 * For power_user profile: register all extension group tools immediately.
 * Batches notifications so only 1 tools/list_changed fires regardless of tool count.
 */
export function registerAllExtensionGroupTools(server: McpServer, bridge: Bridge, readOnly: boolean = false): void {
  batchToolRegistration(server, () => {
    for (const [name, group] of extensionGroups) {
      if (loadedExtensionGroups.has(name)) continue;
      registerExtGroupTools(server, bridge, group, readOnly);
      loadedExtensionGroups.add(name);
    }
  });
}
