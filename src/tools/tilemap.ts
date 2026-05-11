import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../types.js";
import { registerTools } from "../tool_helpers.js";

export const tilemapTools: ToolDef[] = [
  {
    name: "tilemap_set_cells",
    method: "tilemap.set_cells",
    description:
      "Batch-set cells on TileMap or TileMapLayer. Single UndoRedo action. Returns cells_written + cells_unchanged. source_id:-1 clears a cell.",
    inputSchema: {
      tilemap_path: z.string(),
      layer: z.number().optional(),
      cells: z
        .array(z.record(z.string(), z.unknown()))
        .describe("Array of {x, y, source_id, atlas_x, atlas_y, alternative_tile?}. source_id:-1 clears."),
    },
    annotations: { openWorldHint: false },
  },
  {
    name: "tileset_create",
    method: "tileset.create",
    description:
      "Create a TileSet .tres from a texture. Auto-generates atlas tiles " +
      "with full-tile collision polygons (physics on by default). Returns " +
      "source_id + atlas grid dims — use these with tilemap_set_cells.",
    inputSchema: {
      file_path: z.string().describe("Output path, e.g. 'res://resources/tileset.tres'"),
      texture_path: z.string().describe("Texture for the atlas source, e.g. 'res://assets/tiles.png'"),
      tile_size: z
        .object({
          x: z.number().int().positive(),
          y: z.number().int().positive(),
        })
        .optional()
        .describe("Tile size in pixels. Default {x:16, y:16}"),
      physics: z.boolean().optional().describe("Add physics layer. Default true"),
      collision_layer: z.number().int().optional().describe("Physics collision layer bitmask. Default 1"),
      collision_mask: z.number().int().optional().describe("Physics collision mask bitmask. Default 1"),
    },
    annotations: { idempotentHint: false, openWorldHint: false },
  },
];

export function register(server: McpServer, bridge: Bridge, allowedTools: Set<string> | null = null): void {
  registerTools(server, bridge, tilemapTools, allowedTools);
}
