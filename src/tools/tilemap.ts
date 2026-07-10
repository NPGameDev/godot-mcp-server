import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../shared/types.js";
import { registerTools } from "../registration/toolRegistry.js";
import { jsonCoerce } from "../shared/schemaCoercion.js";
import { paginationDoc } from "../shared/pagination.js";

export const tilemapTools: ToolDef[] = [
  {
    name: "tilemap_read_cells",
    method: "tilemap.read_cells",
    description:
      "Read placed tile data from a TileMapLayer (4.3+) or deprecated TileMap. Returns cell coords, source_id, atlas_coords. 500-cell cap. " +
      paginationDoc("cells", { resumable: false, cursorlessNav: "narrow with region/source_id" }),
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
      node_path: z.string(),
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
];

export function register(server: McpServer, bridge: Bridge, allowedTools?: Set<string>): void {
  registerTools(server, bridge, tilemapTools, allowedTools);
}
