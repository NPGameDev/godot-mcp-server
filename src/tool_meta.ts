/**
 * Tool metadata enrichment for discover_tools responses.
 *
 * Converts ToolDef (Zod schemas) and ExtensionCmd (raw JSON Schema) into
 * lightweight, LLM-readable metadata objects. Used by the discover_tools
 * handler to enrich activation responses so agents can call tools without
 * a separate schema lookup round-trip.
 */

import { z } from "zod";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { ToolDef } from "./types.js";
import type { ExtensionCmd } from "./groups.js"; // type-only: no circular runtime dep
import { jsonSchemaToParamMap, type ParamInfo } from "./tool_helpers.js";

// ── Types ────────────────────────────────────────────────────────────

/** Lightweight tool metadata returned in discover_tools responses. */
export interface ToolMeta {
  name: string;
  description?: string;
  parameters?: Record<string, ParamInfo>;
  annotations?: ToolAnnotations;
}

/** Group result with enriched tool metadata. */
export interface GroupResult {
  name: string;
  status: "activated" | "available" | "already_loaded" | "gated";
  tools: ToolMeta[];
  description?: string;
  gate?: string;
  match?: "exact_name" | "loose_keyword";
}

// ── Enrichment helpers ───────────────────────────────────────────────

/**
 * Build a ToolMeta from a built-in ToolDef.
 * Converts the Zod inputSchema to JSON Schema via z.toJSONSchema(),
 * then flattens to a simplified param map.
 */
function enrichBuiltinTool(def: ToolDef, includeSchemas: boolean): ToolMeta {
  const meta: ToolMeta = { name: def.name, description: def.description };
  if (includeSchemas) {
    const jsonSchema = z.toJSONSchema(z.object(def.inputSchema));
    meta.parameters = jsonSchemaToParamMap(jsonSchema as Record<string, unknown>);
    if (def.annotations) meta.annotations = def.annotations;
  }
  return meta;
}

/**
 * Build a ToolMeta from an ExtensionCmd.
 * Extension schemas are already raw JSON Schema — flatten directly.
 */
function enrichExtensionTool(cmd: ExtensionCmd, includeSchemas: boolean): ToolMeta {
  const meta: ToolMeta = { name: cmd.toolName, description: cmd.description };
  if (includeSchemas) {
    meta.parameters = jsonSchemaToParamMap(cmd.inputSchema);
    if (cmd.annotations) meta.annotations = cmd.annotations as unknown as ToolAnnotations;
  }
  return meta;
}

// ── Post-collection enrichment ───────────────────────────────────────

/**
 * Enrich group results after collection. For activated/already_loaded
 * groups, replace bare tool names with full metadata. For available/gated,
 * tools stay as {name} only.
 *
 * @param results - Raw group results from activateOrReportGroup()
 * @param includeSchemas - Whether to include parameters + annotations
 * @param allDefs - Master lookup of all built-in ToolDefs by name
 * @param extGroupCommands - Lookup of extension commands by tool name
 */
export function enrichGroupResults(
  results: GroupResult[],
  includeSchemas: boolean,
  allDefs: Map<string, ToolDef>,
  extGroupCommands: Map<string, ExtensionCmd>,
): GroupResult[] {
  for (const result of results) {
    if (result.status !== "activated" && result.status !== "already_loaded") continue;
    result.tools = result.tools.map((tool) => {
      const def = allDefs.get(tool.name);
      if (def) return enrichBuiltinTool(def, includeSchemas);
      const extCmd = extGroupCommands.get(tool.name);
      if (extCmd) return enrichExtensionTool(extCmd, includeSchemas);
      // Fallback: tool name only (shouldn't happen for loaded groups).
      return tool;
    });
  }
  return results;
}
