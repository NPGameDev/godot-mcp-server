import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../types.js";
import { registerTools, coercedBoolean, jsonCoerce } from "../tool_helpers.js";

export const tilemapTools: ToolDef[] = [
  {
    name: "tilemap_read_cells",
    method: "tilemap.read_cells",
    description:
      "Read placed tile data from a TileMapLayer (4.3+) or deprecated TileMap. " +
      "Returns cell coords, source_id, atlas_coords. 500-cell cap with spatial pagination via region.",
    inputSchema: {
      node_path: z.string().describe("Path to TileMapLayer or TileMap node"),
      region: z
        .object({
          x: z.coerce.number().int(),
          y: z.coerce.number().int(),
          width: z.coerce.number().int().positive(),
          height: z.coerce.number().int().positive(),
        })
        .optional()
        .describe("Spatial filter: only cells within {x, y, width, height}"),
      source_id: z.coerce.number().int().optional().describe("Filter to cells from this atlas source"),
      layer: z.coerce.number().int().optional().describe("Layer index for deprecated TileMap (default 0)"),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "tilemap_set_cells",
    method: "tilemap.set_cells",
    description:
      "Batch-set cells on TileMap or TileMapLayer. Returns cells_written + cells_unchanged. " +
      "source_id:-1 clears a cell. Use 'regions' for bulk rectangular fills (far more efficient than listing individual cells).",
    inputSchema: {
      tilemap_path: z.string(),
      layer: z.coerce.number().optional(),
      cells: z
        .preprocess(jsonCoerce, z.array(z.record(z.string(), z.unknown())))
        .optional()
        .describe("Array of {x, y, source_id, atlas_x, atlas_y, alternative_tile?}. source_id:-1 clears."),
      regions: z
        .preprocess(jsonCoerce, z.array(z.record(z.string(), z.unknown())))
        .optional()
        .describe(
          "Array of rectangular fills: [{x, y, width, height, source_id, atlas_x, atlas_y, alternative_tile?}]. " +
            "Each region expands into width*height cells. Far more efficient than listing individual cells for room-scale fills. " +
            "Can be combined with 'cells' — regions are appended to cells.",
        ),
    },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
  },
  {
    name: "tileset_create",
    method: "tileset.create",
    description:
      "Create a TileSet .tres from a texture. Generates atlas tiles " +
      "with full-tile rectangular collision (physics on by default). Returns " +
      "source_id + grid dims — use these with tilemap_set_cells.",
    inputSchema: {
      file_path: z.string().describe("Output path, e.g. 'res://resources/tileset.tres'"),
      texture_path: z.string().describe("Texture for the atlas source, e.g. 'res://assets/tiles.png'"),
      tile_size: z
        .object({
          x: z.coerce.number().int().positive(),
          y: z.coerce.number().int().positive(),
        })
        .optional()
        .describe("Tile size in pixels. Default {x:16, y:16}"),
      physics: coercedBoolean().optional().describe("Add physics layer. Default true"),
      collision_layer: z
        .union([z.coerce.number().int(), z.array(z.union([z.coerce.number().int(), z.string()]))])
        .optional()
        .describe(
          "Physics collision layer. Integer bitmask OR array of layer numbers [1,6] or names ['player','walls']. Default 1",
        ),
      collision_mask: z
        .union([z.coerce.number().int(), z.array(z.union([z.coerce.number().int(), z.string()]))])
        .optional()
        .describe(
          "Physics collision mask. Integer bitmask OR array of layer numbers [2,4] or names ['enemies','collectibles']. Default 1",
        ),
    },
    annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false, destructiveHint: false },
    successHint: "Customize tiles with tileset_edit. Apply to map with tilemap_set_cells.",
  },
  {
    name: "tileset_edit",
    method: "tileset.edit",
    description:
      "Edit per-tile properties on an existing TileSet: collision polygons, " +
      "terrain peering, navigation, occlusion, custom data, animation, " +
      "probability, alternatives, and adding atlas sources.",
    inputSchema: {
      file_path: z.string().describe("Path to existing .tres TileSet"),
      source_id: z.coerce.number().int().optional().describe("Atlas source id for per-tile edits. Default 0"),
      tiles: z
        .preprocess(jsonCoerce, z.array(z.record(z.string(), z.unknown())))
        .optional()
        .describe(
          "Per-tile edits: [{atlas_x, atlas_y, physics_polygon?, terrain_set?, terrain?, " +
            "terrain_peering?, navigation_polygon?, occlusion_polygon?, custom_data?, " +
            "animation?, probability?, alternative?}]",
        ),
      add_source: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Add atlas source: {texture_path, tile_size?: {x, y}}"),
      layers: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          "Layer setup (before tile edits): {terrain_sets?, custom_data?, " +
            "navigation_layers?: <int count>, occlusion_layers?: <int count>, physics_layers?: <int count>}",
        ),
    },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
  },
];

export function register(server: McpServer, bridge: Bridge, allowedTools: Set<string> | null = null): void {
  registerTools(server, bridge, tilemapTools, allowedTools);
}
