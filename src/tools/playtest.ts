import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../types.js";
import { callAndWrap } from "../types.js";
import { isGroupLoaded } from "../groups.js";

export const playtestTools: ToolDef[] = [
  {
    name: "game_start",
    method: "game.start",
    description:
      "Start playtest. scene_path:'main'|'current'(default)|res://path. Polls runtime when wait_for_runtime:true(default). ALREADY_PLAYING if live — use runtime_poll:true to re-probe.",
    inputSchema: {
      scene_path: z.string().optional(),
      wait_for_runtime: z.boolean().optional(),
      runtime_poll: z.boolean().optional(),
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
  for (const tool of playtestTools) {
    if (allowedTools && !allowedTools.has(tool.name)) continue;

    if (tool.name === "game_start") {
      // Custom handler: append runtime group hint when group not loaded.
      server.registerTool(
        tool.name,
        { description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations },
        async (input: unknown) => {
          const result = await callAndWrap(bridge, tool.method, input);
          // Inject hint if game started successfully and runtime group not loaded.
          if (!isGroupLoaded("runtime") && result.content?.[0]?.type === "text") {
            try {
              const payload = JSON.parse(result.content[0].text);
              if (payload.success && !result.isError) {
                payload.group_hint =
                  "Game started. To interact with the running game, call " +
                  "enable_tool_group(['runtime', 'signals']) to access runtime tools.";
                result.content[0].text = JSON.stringify(payload);
              }
            } catch {
              /* parse failure — pass through unchanged */
            }
          }
          return result;
        },
      );
    } else {
      server.registerTool(
        tool.name,
        { description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations },
        (input: unknown) => callAndWrap(bridge, tool.method, input),
      );
    }
  }
}
