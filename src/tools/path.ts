import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../types.js";
import { registerTools } from "../tool_registry.js";
import { jsonCoerce } from "../schema_coercion.js";

export const pathTools: ToolDef[] = [
  {
    name: "path2d_edit_curve",
    method: "path2d.edit_curve",
    description:
      "Edit a Path2D node's Curve2D — set, add, or remove points with bezier control handles. For patrol routes, moving platforms, projectile curves, and camera rails.",
    inputSchema: {
      node_path: z.string().describe("Path2D node path in the scene tree"),
      action: z
        .enum(["set", "add", "remove", "clear"])
        .describe("set=replace all, add=append/insert, remove=delete at index, clear=remove all"),
      points: z
        .preprocess(
          jsonCoerce,
          z.array(
            z.object({
              position: z.object({ x: z.number(), y: z.number() }),
              in_handle: z.object({ x: z.number(), y: z.number() }).optional(),
              out_handle: z.object({ x: z.number(), y: z.number() }).optional(),
            }),
          ),
        )
        .optional()
        .describe("Curve points with optional bezier handles"),
      index: z.number().int().optional().describe("Insert position (add) or point index to remove"),
    },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
  },
];

export function register(server: McpServer, bridge: Bridge, allowedTools: Set<string> | null = null): void {
  registerTools(server, bridge, pathTools, allowedTools);
}
