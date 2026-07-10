import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../shared/types.js";
import { registerTools } from "../registration/toolRegistry.js";
import { offsetLimitParams, paginationDoc } from "../shared/pagination.js";

export const sceneQueryTools: ToolDef[] = [
  {
    name: "scene_query",
    method: "scene.query",
    description:
      "Search scene tree with filters (class, group, name glob, property conditions). Returns matching nodes. Faster than scene_get_tree + manual filtering. " +
      paginationDoc("matches", { resumable: true, mutationCaveat: true }) +
      "Results are returned in deterministic depth-first order; nodes echoes offset/limit. limit is 1-200 (default 50, clamped above 200). " +
      "If the tree changes between paged reads (nodes added, removed, or reordered) results may skip or repeat — re-query from offset 0.",
    inputSchema: {
      class_filter: z
        .string()
        .optional()
        .describe("Class name filter (inheritance-aware, e.g. 'CollisionShape2D', 'Control')"),
      group_filter: z.string().optional().describe("Node group membership filter"),
      name_pattern: z.string().optional().describe("Glob pattern for node name (e.g. 'Enemy*', '*Collision*')"),
      property_filters: z
        .array(
          z.object({
            property: z.string().describe("Property name"),
            value: z.unknown().describe("Expected value"),
            operator: z.enum(["eq", "ne", "gt", "lt"]).optional().describe("Comparison operator (default: eq)"),
          }),
        )
        .optional()
        .describe("Property value conditions (AND logic)"),
      root_path: z.string().optional().describe("Subtree root path (default: scene root)"),
      max_depth: z.number().int().optional().describe("Max traversal depth (-1 = unlimited, default -1)"),
      include_properties: z.array(z.string()).optional().describe("Property names to include in results"),
      ...offsetLimitParams,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    successHint: "For full tree structure use scene_get_tree. For specific properties use node_get_property.",
  },
];

export function register(server: McpServer, bridge: Bridge, allowedTools?: Set<string>): void {
  registerTools(server, bridge, sceneQueryTools, allowedTools);
}
