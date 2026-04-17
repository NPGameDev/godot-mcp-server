import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, Profile, ToolDef } from "../types.js";
import { callAndWrap } from "../types.js";

export const playtestTools: ToolDef[] = [
  {
    name: "game_start",
    tier: "full",
    method: "game.start",
    description:
      "Start playtest via EditorInterface. target:'main'|'current'(default)|res://path. Polls Mode-B port 9090 when wait_for_runtime:true(default). ALREADY_PLAYING if one is live.",
    inputSchema: {
      target: z.string().optional(),
      wait_for_runtime: z.boolean().optional(),
    },
  },
  {
    name: "game_stop",
    tier: "full",
    method: "game.stop",
    description:
      "Stop the currently-playing scene (idempotent — returns was_running:false if nothing was running). No params.",
    inputSchema: {},
  },
];

export function register(server: McpServer, bridge: Bridge, profile: Profile = "full"): void {
  for (const tool of playtestTools) {
    if (profile === "lite" && tool.tier !== "lite") continue;
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      (input: unknown) => callAndWrap(bridge, tool.method, input),
    );
  }
}
