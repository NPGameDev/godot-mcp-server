import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../types.js";
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
    annotations: { openWorldHint: false },
  },
];

export function register(server: McpServer, bridge: Bridge, allowedTools: Set<string> | null = null): void {
  for (const tool of tilemapTools) {
    if (allowedTools && !allowedTools.has(tool.name)) continue;
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      },
      (input: unknown) => callAndWrap(bridge, tool.method, input),
    );
  }
}
