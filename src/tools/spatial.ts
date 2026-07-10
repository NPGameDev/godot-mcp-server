import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../shared/types.js";
import { registerTools } from "../registration/toolRegistry.js";
import { jsonCoerce } from "../shared/schemaCoercion.js";
import { paginationDoc } from "../shared/pagination.js";

export const spatialTools: ToolDef[] = [
  {
    name: "scene_spatial_map",
    method: "scene.spatial_map",
    description:
      "Spatial layout of the current scene: per-node world position, bounds (2D Rect2 / 3D AABB), size, plus computed overlaps/gaps/containment. Call before placing or moving nodes to find clear space. " +
      paginationDoc("nodes", {
        resumable: false,
        cursorlessNav: "narrow with subtree/class/region/radius or raise max_nodes",
      }),
    inputSchema: {
      detail: z
        .enum(["brief", "normal", "full"])
        .optional()
        .describe(
          "brief = position/size only; normal = + bounds + overlaps; full = + containment + nearest-neighbour gaps",
        ),
      class: z.string().optional().describe("Only include nodes of this class (ancestry-aware)"),
      subtree: z
        .string()
        .optional()
        .describe("Map only this node and its descendants (node path relative to the scene root)"),
      region: z
        .preprocess(jsonCoerce, z.array(z.number()))
        .optional()
        .describe("Only nodes intersecting this box: [x,y,w,h] (2D) or [x,y,z,sx,sy,sz] (3D)"),
      radius: z.coerce.number().optional().describe("Only nodes within this distance of center"),
      center: z
        .preprocess(jsonCoerce, z.array(z.number()))
        .optional()
        .describe("Center for radius filter: [x,y] (2D) or [x,y,z] (3D)"),
      max_nodes: z.coerce.number().optional().describe("Response cap (default 200, max 1000)"),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    successHint:
      "Reason about a clear position from the overlaps/gaps, then place or move nodes with node_set_property (position / global_position).",
  },
];

export function register(server: McpServer, bridge: Bridge, allowedTools?: Set<string>): void {
  registerTools(server, bridge, spatialTools, allowedTools);
}
