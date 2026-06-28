import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../shared/types.js";
import { registerTools } from "../registration/toolRegistry.js";
import { coercedBoolean, jsonCoerce } from "../shared/schemaCoercion.js";
import { PROJECT_FILE_PATH } from "../security/pathGuard.js";

// ── tileset group (structural) ──────────────────────────────────────

// Every tileset tool guards its res:// file_path; texture_path is NOT guarded
// (toolkit load() is res://-scoped). Declared uniformly via .map below.
const tilesetStructuralDefs: ToolDef[] = [
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
    successHint:
      "Use tileset_add_source to add more atlas textures, then tileset_setup_layers to configure " +
      "physics/terrain/navigation layers. For per-tile properties (collision polygons, terrain, navigation), " +
      "use discover_tools(request: 'tileset_edit') to activate the per-tile editing group.",
  },
  {
    name: "tileset_add_source",
    method: "tileset.add_source",
    description:
      "Add an atlas source to an existing TileSet. Auto-creates tiles for every " +
      "grid cell in the texture. Returns the new source_id.",
    inputSchema: {
      file_path: z.string().describe("Path to existing .tres TileSet"),
      texture_path: z.string().describe("Texture for the new atlas source"),
      tile_size: z
        .object({
          x: z.coerce.number().int().positive(),
          y: z.coerce.number().int().positive(),
        })
        .optional()
        .describe("Tile size in pixels. Defaults to the TileSet's tile_size"),
    },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
    successHint:
      "Source added. Use tileset_setup_layers to configure physics/terrain/navigation layers if not done yet.",
  },
  {
    name: "tileset_remove_source",
    method: "tileset.remove_source",
    description: "Remove an atlas source from a TileSet. This deletes all tile data for that source.",
    inputSchema: {
      file_path: z.string().describe("Path to existing .tres TileSet"),
      source_id: z.coerce.number().int().describe("Atlas source id to remove"),
    },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: true },
  },
  {
    name: "tileset_add_alternative",
    method: "tileset.add_alternative",
    description: "Create an alternative tile variant (flip, rotate, recolor) for a base tile.",
    inputSchema: {
      file_path: z.string().describe("Path to existing .tres TileSet"),
      source_id: z.coerce.number().int().optional().describe("Atlas source id. Default 0"),
      atlas_x: z.coerce.number().int().describe("Base tile X coordinate in the atlas"),
      atlas_y: z.coerce.number().int().describe("Base tile Y coordinate in the atlas"),
      flip_h: coercedBoolean().optional().describe("Flip horizontally"),
      flip_v: coercedBoolean().optional().describe("Flip vertically"),
      transpose: coercedBoolean().optional().describe("Transpose (swap X/Y)"),
      modulate: z
        .object({
          r: z.coerce.number().optional(),
          g: z.coerce.number().optional(),
          b: z.coerce.number().optional(),
          a: z.coerce.number().optional(),
        })
        .optional()
        .describe("Color modulation {r, g, b, a} — each 0.0–1.0"),
    },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
    successHint: "Alternative created. Use tilemap_set_cells with alternative_tile to place it.",
  },
  {
    name: "tileset_remove_alternative",
    method: "tileset.remove_alternative",
    description: "Remove an alternative tile variant from a base tile.",
    inputSchema: {
      file_path: z.string().describe("Path to existing .tres TileSet"),
      source_id: z.coerce.number().int().optional().describe("Atlas source id. Default 0"),
      atlas_x: z.coerce.number().int().describe("Base tile X coordinate in the atlas"),
      atlas_y: z.coerce.number().int().describe("Base tile Y coordinate in the atlas"),
      alternative_id: z.coerce.number().int().describe("Alternative tile id to remove"),
    },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: true },
  },
  {
    name: "tileset_setup_layers",
    method: "tileset.setup_layers",
    description:
      "Configure TileSet layers: terrain sets (with named terrains), custom data layers, " +
      "and physics/navigation/occlusion layer counts.",
    inputSchema: {
      file_path: z.string().describe("Path to existing .tres TileSet"),
      terrain_sets: z
        .preprocess(
          jsonCoerce,
          z.array(
            z.object({
              mode: z
                .enum(["match_corners_and_sides", "match_corners", "match_sides"])
                .optional()
                .describe("Terrain matching mode. Default match_corners_and_sides"),
              terrains: z.array(z.string()).optional().describe("Named terrains in this set"),
            }),
          ),
        )
        .optional()
        .describe("Terrain sets to add"),
      custom_data: z
        .preprocess(
          jsonCoerce,
          z.array(
            z.object({
              name: z.string().describe("Layer name"),
              type: z
                .enum(["int", "float", "bool", "string", "vector2", "vector2i", "vector3", "color"])
                .optional()
                .describe("Data type. Default int"),
            }),
          ),
        )
        .optional()
        .describe("Custom data layers to add"),
      navigation_layers: z.coerce.number().int().optional().describe("Desired navigation layer count"),
      occlusion_layers: z.coerce.number().int().optional().describe("Desired occlusion layer count"),
      physics_layers: z.coerce.number().int().optional().describe("Desired physics layer count"),
    },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
    successHint: "Layers configured. Use discover_tools(request: 'tileset_edit') to set per-tile properties.",
  },
];

export const tilesetStructuralTools: ToolDef[] = tilesetStructuralDefs.map((t) => ({
  ...t,
  pathParams: [PROJECT_FILE_PATH],
}));

// ── tileset_edit group (per-tile properties) ─────────────────────────

const tileArraySchema = z
  .preprocess(jsonCoerce, z.array(z.record(z.string(), z.unknown())))
  .describe("Per-tile edits: [{atlas_x, atlas_y, ...domain-specific params}]");

const tilesetEditDefs: ToolDef[] = [
  {
    name: "tileset_edit_physics",
    method: "tileset.edit_physics",
    description:
      "Set collision polygons on TileSet tiles. Supports shortcuts ('full', 'none', 'one_way') " +
      "or custom polygon arrays [{x, y}].",
    inputSchema: {
      file_path: z.string().describe("Path to existing .tres TileSet"),
      source_id: z.coerce.number().int().optional().describe("Atlas source id. Default 0"),
      tiles: tileArraySchema.describe(
        "Per-tile edits: [{atlas_x, atlas_y, physics_polygon: 'full'|'none'|'one_way'|[{x,y}], " +
          "physics_layer?: int, one_way_collision?: bool}]",
      ),
    },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
    successHint:
      "Collision set. Other per-tile tools in this group: tileset_edit_terrain, " +
      "tileset_edit_navigation, tileset_edit_visuals, tileset_edit_custom_data.",
  },
  {
    name: "tileset_edit_terrain",
    method: "tileset.edit_terrain",
    description: "Assign terrain sets and peering bits to TileSet tiles for auto-tiling.",
    inputSchema: {
      file_path: z.string().describe("Path to existing .tres TileSet"),
      source_id: z.coerce.number().int().optional().describe("Atlas source id. Default 0"),
      tiles: tileArraySchema.describe(
        "Per-tile edits: [{atlas_x, atlas_y, terrain_set: int, terrain?: int, " +
          "terrain_peering?: {right?: int, bottom?: int, left?: int, top?: int, ...}}]",
      ),
    },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
    successHint: "Terrain assigned. Set up terrain sets first with tileset_setup_layers if needed.",
  },
  {
    name: "tileset_edit_navigation",
    method: "tileset.edit_navigation",
    description: "Set navigation polygons on TileSet tiles. Supports 'full', 'none', or custom polygon arrays.",
    inputSchema: {
      file_path: z.string().describe("Path to existing .tres TileSet"),
      source_id: z.coerce.number().int().optional().describe("Atlas source id. Default 0"),
      tiles: tileArraySchema.describe(
        "Per-tile edits: [{atlas_x, atlas_y, navigation_polygon: 'full'|'none'|[{x,y}], " + "navigation_layer?: int}]",
      ),
    },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
    successHint: "Navigation polygon set. Other per-tile tools: tileset_edit_physics, tileset_edit_terrain.",
  },
  {
    name: "tileset_edit_visuals",
    method: "tileset.edit_visuals",
    description: "Set occlusion polygons, tile animations, and probability weights on TileSet tiles.",
    inputSchema: {
      file_path: z.string().describe("Path to existing .tres TileSet"),
      source_id: z.coerce.number().int().optional().describe("Atlas source id. Default 0"),
      tiles: tileArraySchema.describe(
        "Per-tile edits: [{atlas_x, atlas_y, occlusion_polygon?: 'full'|'none'|[{x,y}], " +
          "occlusion_layer?: int, animation?: {frame_count, columns?, frame_duration?, separation?}, " +
          "probability?: number}]",
      ),
    },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
    successHint: "Visual properties set. Other per-tile tools: tileset_edit_physics, tileset_edit_terrain.",
  },
  {
    name: "tileset_edit_custom_data",
    method: "tileset.edit_custom_data",
    description:
      "Set custom data values on TileSet tiles. Custom data layers must be " +
      "configured first with tileset_setup_layers.",
    inputSchema: {
      file_path: z.string().describe("Path to existing .tres TileSet"),
      source_id: z.coerce.number().int().optional().describe("Atlas source id. Default 0"),
      tiles: tileArraySchema.describe('Per-tile edits: [{atlas_x, atlas_y, custom_data: {"layer_name": value, ...}}]'),
    },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
    successHint: "Custom data set. Configure layers first with tileset_setup_layers if needed.",
  },
];

export const tilesetEditTools: ToolDef[] = tilesetEditDefs.map((t) => ({
  ...t,
  pathParams: [PROJECT_FILE_PATH],
}));

export const tilesetTools: ToolDef[] = [...tilesetStructuralTools, ...tilesetEditTools];

export function register(server: McpServer, bridge: Bridge, allowedTools?: Set<string>): void {
  registerTools(server, bridge, tilesetTools, allowedTools);
}
