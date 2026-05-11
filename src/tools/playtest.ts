import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef, ToolTextResult } from "../types.js";
import { callAndWrap, registerTools, coercedBoolean } from "../tool_helpers.js";
import { isGroupLoaded } from "../groups.js";

export const playtestTools: ToolDef[] = [
  {
    name: "game_start",
    method: "game.start",
    description:
      "Start playtest. scene_path:'main'|'current'(default)|res://path. if_running:'return' for idempotent mode (default 'fail'). runtime_poll:true re-probes runtime (overrides if_running).",
    inputSchema: {
      scene_path: z.string().optional(),
      wait_for_runtime: coercedBoolean().optional(),
      runtime_poll: coercedBoolean().optional(),
      if_running: z.enum(["return", "fail"]).optional(),
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
  const handlers = new Map<string, (input: Record<string, unknown>) => Promise<ToolTextResult>>();
  handlers.set("game_start", async (input) => {
    const result = await callAndWrap(bridge, "game.start", input);
    // Inject hint if game started successfully and runtime group not loaded.
    if (!isGroupLoaded("runtime") && result.content?.[0]?.type === "text") {
      try {
        const payload = JSON.parse(result.content[0].text);
        if (payload.success && !result.isError) {
          payload.group_hint =
            "Game started. To interact with the running game, call " +
            "discover_tools({request: 'runtime'}) to access runtime tools.";
          result.content[0].text = JSON.stringify(payload);
        }
      } catch {
        /* parse failure — pass through unchanged */
      }
    }
    return result;
  });
  registerTools(server, bridge, playtestTools, allowedTools ? allowedTools : null, { handlers });
}
