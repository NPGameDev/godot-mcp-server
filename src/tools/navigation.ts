import { z } from "zod";
import type { ToolDef } from "../shared/types.js";

export const navigationTools: ToolDef[] = [
  {
    name: "navigation_edit",
    method: "navigation.edit_polygon",
    description:
      "Edit NavigationRegion2D polygon outlines: set all outlines, add/remove individual outlines, clear, or bake the navigation mesh. Required for AI pathfinding setup.",
    inputSchema: {
      node_path: z.string().describe("Path to NavigationRegion2D node"),
      action: z.enum(["set", "add_outline", "remove_outline", "clear", "bake"]).describe("Polygon operation"),
      outlines: z
        .array(z.array(z.object({ x: z.number(), y: z.number() })))
        .optional()
        .describe("For 'set': array of outline arrays (each outline = array of {x,y} points)"),
      outline: z
        .array(z.object({ x: z.number(), y: z.number() }))
        .optional()
        .describe("For 'add_outline': single outline as array of {x,y} points"),
      index: z.number().int().optional().describe("For 'remove_outline': outline index"),
    },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: true },
    successHint: "After defining polygons, call with action 'bake' to generate the navigation mesh.",
  },
];
