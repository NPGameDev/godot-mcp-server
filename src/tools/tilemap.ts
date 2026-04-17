import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, Profile, ToolDef } from "../types.js";
import { callAndWrap } from "../types.js";

export const tilemapTools: ToolDef[] = [
  {
    name: "tilemap_set_cells",
    tier: "full",
    method: "tilemap.set_cells",
    description:
      "Batch-set cells on TileMap or TileMapLayer. Single UndoRedo action. Returns cells_written + cells_unchanged. source_id:-1 clears a cell.",
    inputSchema: {
      tilemap_path: z.string(),
      layer: z.number().optional(),
      cells: z.array(z.record(z.string(), z.unknown())),
    },
  },
];

export function register(server: McpServer, bridge: Bridge, profile: Profile = "full"): void {
  for (const tool of tilemapTools) {
    if (profile === "lite" && tool.tier !== "lite") continue;
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      (input: unknown) => callAndWrap(bridge, tool.method, input),
    );
  }
}
