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

// ── Types ────────────────────────────────────────────────────────────

/** Simplified parameter info for LLM-facing tool metadata. */
export interface ParamInfo {
  type: string;
  required: boolean;
  description?: string;
}

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
  status: "activated" | "available" | "already_loaded";
  tools: ToolMeta[];
  description?: string;
  match?: "exact_name" | "loose_keyword";
}

// ── JSON Schema → param map (reverse of jsonSchemaToZodShape) ──────

/**
 * Flatten a JSON Schema properties/required structure to a simplified
 * parameter map. Mirrors jsonSchemaToZodShape() in reverse — used by
 * tool_meta.ts to build human-readable param info for discover_tools
 * enrichment. Handles the same types as jsonSchemaToZodShape.
 */
export function jsonSchemaToParamMap(schema: Record<string, unknown>): Record<string, ParamInfo> {
  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
  if (!properties) return {};

  const required = new Set((schema.required as string[]) ?? []);
  const params: Record<string, ParamInfo> = {};

  for (const [key, prop] of Object.entries(properties)) {
    let type: string;
    switch (prop.type) {
      case "string":
        type = Array.isArray(prop.enum) && prop.enum.length > 0 ? "enum" : "string";
        break;
      case "number":
      case "integer":
        type = "number";
        break;
      case "boolean":
        type = "boolean";
        break;
      case "array":
        type = "array";
        break;
      default:
        type = "string";
        break;
    }
    const description = typeof prop.description === "string" ? prop.description : undefined;
    params[key] = { type, required: required.has(key), ...(description && { description }) };
  }
  return params;
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
 * groups, replace bare tool names with full metadata. For available
 * groups, tools stay as {name} only.
 *
 * @param results - Raw group results from the discover_tools handler (activateGroupByName / reportGroupStatusByName)
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
