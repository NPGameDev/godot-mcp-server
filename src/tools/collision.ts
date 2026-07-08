import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../shared/types.js";
import { registerTools } from "../registration/toolRegistry.js";

export const collisionTools: ToolDef[] = [
  {
    name: "collision_from_texture",
    method: "node.collision_from_sprite",
    description:
      "Auto-generate CollisionPolygon2D from a Sprite2D's texture alpha. Uses BitMap to trace opaque regions. For platformer terrain, character hitboxes, irregular shapes.",
    inputSchema: {
      sprite_path: z.string().describe("Path to a Sprite2D/TextureRect node with a texture"),
      parent_path: z.string().optional().describe("Parent for the new CollisionPolygon2D (default: sprite's parent)"),
      target_name: z.string().optional().describe("Name for the CollisionPolygon2D (default: {sprite}_collision)"),
      simplification: z
        .number()
        .optional()
        .describe("Polygon simplification epsilon 0.0-10.0 (default 2.0, higher=fewer points)"),
    },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
    successHint: "Assign the generated polygon to a CollisionPolygon2D via node_set_property.",
  },
];

export function register(server: McpServer, bridge: Bridge, allowedTools?: Set<string>): void {
  registerTools(server, bridge, collisionTools, allowedTools);
}
