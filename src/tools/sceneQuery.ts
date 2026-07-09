import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../shared/types.js";
import { registerTools } from "../registration/toolRegistry.js";

export const sceneQueryTools: ToolDef[] = [
  {
    name: "scene_query",
    method: "scene.query",
    description:
      "Search scene tree with filters (class, group, name glob, property conditions). Returns matching nodes. Faster than scene_get_tree + manual filtering. " +
      "Response is a paged envelope: nodes (this page, <= limit), offset/limit (echoed), returned (nodes on this page), total_matches (all matches, not just this page), has_more, and — when has_more — next_offset + a hint. " +
      "Page by re-calling with offset = next_offset until has_more is false. When a requested limit exceeds the 200 cap it is clamped: the effective limit is echoed and limit_clamped:true is added. " +
      "Results are returned in deterministic depth-first order. Pages are stable only if the scene tree is unchanged between calls — adding, removing, or reordering nodes between paged reads may skip or repeat results; re-query from offset 0 if the tree changed.",
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
      offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe(
          "Skip the first N matches (deterministic DFS order); pass next_offset from a has_more response back as offset until has_more is false. Default 0.",
        ),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Page size, 1-200 (default 50); requests above 200 are clamped."),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    successHint: "For full tree structure use scene_get_tree. For specific properties use node_get_property.",
  },
];

export function register(server: McpServer, bridge: Bridge, allowedTools?: Set<string>): void {
  registerTools(server, bridge, sceneQueryTools, allowedTools);
}
