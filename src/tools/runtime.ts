import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../types.js";
import { callAndWrap, toolErrorFromException, toolErrorFromPayload } from "../types.js";
import { isEnabled } from "../feature_gate.js";

// Mode B — tools that talk to the game-side runtime autoload on
// 127.0.0.1:9090. Only works while the game is running in a debug build
// (release exports never ship the autoload). Bridge.callRuntime maps the
// connect failure to GAME_NOT_RUNNING for us.

export const runtimeTools: ToolDef[] = [
  {
    name: "runtime_screenshot",
    tier: "full",
    method: "runtime.screenshot",
    description: "Capture a frame from the running game's main viewport (Mode B, debug build). Returns inline PNG image content.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "runtime_get_node_state",
    tier: "full",
    method: "runtime.get_node_state",
    description: "Inspect a live node at path in the running game: returns { name, class, path, properties } (inspector-visible fields only).",
    inputSchema: { node_path: z.string() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "debugger_get_log",
    tier: "full",
    method: "debugger.get_log",
    description: "Return recent lines from the running game's log file (user://logs/godot.log). Optional limit (default 200).",
    inputSchema: { limit: z.number().int().positive().optional() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "input_simulate",
    tier: "full",
    method: "input.simulate",
    description: "Inject an input event into the running game (Mode B). event_type: key|mouse_button|mouse_motion|action; event_data shape varies. Returns { ok }.",
    inputSchema: {
      event_type: z.enum(["key", "mouse_button", "mouse_motion", "action"]),
      event_data: z.unknown().optional(),
    },
    annotations: { openWorldHint: false },
  },
  {
    name: "animation_player_control",
    tier: "full",
    method: "animation_player.control",
    description: "Drive an AnimationPlayer in the running game. operation: play|pause|stop|seek. Optional animation_name (play) or time (seek). Returns post-op state.",
    inputSchema: {
      node_path: z.string(),
      operation: z.enum(["play", "pause", "stop", "seek"]),
      animation_name: z.string().optional(),
      time: z.number().optional(),
    },
    annotations: { openWorldHint: false },
  },
];

// game_eval is RCE-equivalent and intentionally absent from the catalogue
// unless the user opts in via env var. The plugin-side FeatureGate
// (feature_gate.gd) performs the full dual-gate check as defence-in-depth;
// the gate here only controls MCP-catalogue exposure to Claude.
if (isEnabled("game_eval")) {
  runtimeTools.push({
    name: "game_eval",
    tier: "full",
    method: "game.eval",
    description: "DANGER: evaluates GDScript via Expression in the running game's context. Disabled by default. Set GODOT_MCP_ALLOW_GAME_EVAL=1 to enable.",
    inputSchema: { code: z.string(), scope_path: z.string().optional() },
    annotations: { destructiveHint: true, openWorldHint: false },
  });
}

export function register(server: McpServer, bridge: Bridge, allowedTools: Set<string> | null = null): void {
  for (const tool of runtimeTools) {
    if (allowedTools && !allowedTools.has(tool.name)) continue;
    if (tool.name === "runtime_screenshot") {
      server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: tool.annotations,
        },
        async () => {
          let result: {
            image_base64?: string;
            mime_type?: string;
            width?: number;
            height?: number;
            bytes?: number;
          };
          try {
            result = (await bridge.callRuntime(tool.method, {})) as typeof result;
          } catch (err) {
            return toolErrorFromException(err);
          }
          const payloadErr = toolErrorFromPayload(result);
          if (payloadErr) return payloadErr;
          if (!result?.image_base64) {
            return toolErrorFromPayload({ success: false, code: "INTERNAL", error: "runtime screenshot returned no image bytes" })!;
          }
          return {
            content: [
              { type: "image" as const, data: result.image_base64, mimeType: result.mime_type ?? "image/png" },
              { type: "text" as const, text: JSON.stringify({ width: result.width, height: result.height, bytes: result.bytes }) },
            ],
          };
        },
      );
    } else {
      // TODO(security): wrap debugger_get_log's `lines` array in an
      // <untrusted kind="game_log" source="godot"> envelope before
      // returning.
      server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: tool.annotations,
        },
        (input: unknown) => callAndWrap(bridge, tool.method, input, { runtime: true }),
      );
    }
  }
}
