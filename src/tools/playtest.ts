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
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
  },
  {
    name: "game_stop",
    method: "game.stop",
    description:
      "Stop the currently-playing scene (idempotent — returns was_running:false if nothing was running). No params.",
    inputSchema: {},
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
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
    // Server-side wait-for-runtime: absorb the async gap so agents get
    // single-call game launch instead of a two-step dance.
    if (input.wait_for_runtime && result.content?.[0]?.type === "text" && !result.isError) {
      try {
        const payload = JSON.parse(result.content[0].text);
        if (payload.runtime_discovery === "bridge" && bridge.waitForRuntimeConnection) {
          const runtime = await bridge.waitForRuntimeConnection(10_000);
          if (runtime) {
            // Success — merge runtime info, drop the bridge-discovery marker.
            payload.runtime_ready = true;
            payload.runtime_port = runtime.port;
            delete payload.runtime_discovery;
            delete payload.hint;
          } else {
            // Timeout — add fallback hint (toolkit hint is suppressed when
            // wait_for_runtime=true, so the agent needs guidance here).
            payload.hint =
              "Game launched but runtime did not connect within 10s. " +
              "Follow up with game_start(if_running:'return', runtime_poll:true) " +
              "to retry, or check editor_get_console for startup errors.";
          }
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
