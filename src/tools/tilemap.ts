import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Bridge, Profile, callAndWrap, includesInProfile } from "../types.js";
import { ToolDef } from "./scene.js";

export const tilemapTools: ToolDef[] = [
  {
    name: "tilemap_set_cells",
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
    if (!includesInProfile(tool.name, profile)) continue;
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      (input: unknown) => callAndWrap(bridge, tool.method, input),
    );
  }
}
