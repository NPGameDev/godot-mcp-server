import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Bridge, Profile, callAndWrap, includesInProfile, toolErrorFromException, toolErrorFromPayload } from "../types.js";
import { ToolDef } from "./scene.js";

// Mode B — tools that talk to the game-side runtime autoload on
// 127.0.0.1:9090. Only works while the game is running in a debug build
// (release exports never ship the autoload). Bridge.callRuntime maps the
// connect failure to GAME_NOT_RUNNING for us.

export const runtimeTools: ToolDef[] = [
  {
    name: "runtime_screenshot",
    method: "runtime.screenshot",
    description: "Capture a frame from the running game's main viewport (Mode B, debug build). Returns inline PNG image content.",
    inputSchema: {},
  },
  {
    name: "runtime_get_node_state",
    method: "runtime.get_node_state",
    description: "Inspect a live node at path in the running game: returns { name, class, path, properties } (inspector-visible fields only).",
    inputSchema: { path: z.string() },
  },
  {
    name: "debugger_get_log",
    method: "debugger.get_log",
    description: "Return recent lines from the running game's log file (user://logs/godot.log). Optional limit (default 200).",
    inputSchema: { limit: z.number().int().positive().optional() },
  },
  {
    name: "input_simulate",
    method: "input.simulate",
    description: "Inject an input event into the running game (Mode B). event_type: key|mouse_button|mouse_motion|action; event_data shape varies. Returns { ok }.",
    inputSchema: {
      event_type: z.enum(["key", "mouse_button", "mouse_motion", "action"]),
      event_data: z.unknown().optional(),
    },
  },
  {
    name: "animation_player_control",
    method: "animation_player.control",
    description: "Drive an AnimationPlayer in the running game. op: play|pause|stop|seek. Optional animation (play) or time (seek). Returns post-op state.",
    inputSchema: {
      path: z.string(),
      op: z.enum(["play", "pause", "stop", "seek"]),
      animation: z.string().optional(),
      time: z.number().optional(),
    },
  },
];

// game_eval is RCE-equivalent and intentionally absent from the catalogue
// unless the user opts in via env var. Iter 19 generalises this into a
// proper FeatureGate (dual-gate: env + ProjectSettings + per-tool consent).
// The plugin-side handler (`game.eval` in mcp_runtime_server.gd) is always
// listening on port 9090 — anyone with localhost access can reach it
// directly. The gate here only controls MCP-catalogue exposure to Claude.
if (process.env.GODOT_MCP_ALLOW_GAME_EVAL === "1") {
  runtimeTools.push({
    name: "game_eval",
    method: "game.eval",
    description: "DANGER: evaluates GDScript via Expression in the running game's context. Disabled by default. Set GODOT_MCP_ALLOW_GAME_EVAL=1 to enable. See iter-19 for ProjectSettings gate.",
    inputSchema: { code: z.string(), scope_path: z.string().optional() },
  });
}

export function register(server: McpServer, bridge: Bridge, profile: Profile = "full"): void {
  for (const tool of runtimeTools) {
    if (!includesInProfile(tool.name, profile)) continue;
    if (tool.name === "runtime_screenshot") {
      server.registerTool(
        tool.name,
        { description: tool.description, inputSchema: tool.inputSchema },
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
      // TODO(iter-18): wrap debugger_get_log's `lines` array in an
      // <untrusted kind="game_log" source="godot"> envelope before
      // returning. Do not envelope runtime_get_node_state — it's
      // structured property data, not free-form text.
      server.registerTool(
        tool.name,
        { description: tool.description, inputSchema: tool.inputSchema },
        (input: unknown) => callAndWrap(bridge, tool.method, input, { runtime: true }),
      );
    }
  }
}
