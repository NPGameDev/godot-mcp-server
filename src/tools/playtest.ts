import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../types.js";
import { registerTools } from "../types.js";

export const playtestTools: ToolDef[] = [
  {
    name: "game_start",
    method: "game.start",
    description:
      "Start playtest via EditorInterface. scene_path:'main'|'current'(default)|res://path. Polls Mode-B port 6525 when wait_for_runtime:true(default). ALREADY_PLAYING if one is live.",
    inputSchema: {
      scene_path: z.string().optional(),
      wait_for_runtime: z.boolean().optional(),
    },
    annotations: { openWorldHint: false },
  },
  {
    name: "game_stop",
    method: "game.stop",
    description:
      "Stop the currently-playing scene (idempotent — returns was_running:false if nothing was running). No params.",
    inputSchema: {},
    annotations: { destructiveHint: true, openWorldHint: false },
  },
];

export function register(server: McpServer, bridge: Bridge, allowedTools: Set<string> | null = null): void {
  registerTools(server, bridge, playtestTools, allowedTools);
}
