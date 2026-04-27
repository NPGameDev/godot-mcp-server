import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../types.js";
import { callAndWrap } from "../tool_helpers.js";
import { isEnabled } from "../feature_gate.js";

// Mode B — tools that talk to the game-side runtime autoload on
// 127.0.0.1:6525. Only works while the game is running in a debug build
// (release exports never ship the autoload). Bridge.callRuntime maps the
// connect failure to GAME_NOT_RUNNING for us.

// ── Tool definitions ─────────────────────────────────────────────────

export const runtimeTools: ToolDef[] = [
  {
    name: "runtime_screenshot",
    method: "runtime.screenshot",
    description:
      "Capture a frame from the running game's main viewport (Mode B, debug build). Returns inline PNG image content.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "runtime_get_node_state",
    method: "runtime.get_node_state",
    description:
      "Inspect a live node in the running game. Returns { name, class, path, properties } — primarily @export vars and inspector-visible fields.",
    inputSchema: { node_path: z.string() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "debugger_get_log",
    method: "debugger.get_log",
    description:
      "Return recent output from the running game. source='buffer'(default) reads ring buffer; source='file' reads user://logs/godot.log. limit default 200.",
    inputSchema: {
      limit: z.number().int().positive().optional(),
      source: z.enum(["buffer", "file"]).optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    // I2 waiver: input_simulate description intentionally exceeds the 200-char
    // tool-description limit. The events[] batch API has enough per-type
    // nuance that a longer description materially reduces LLM mis-calls.
    name: "input_simulate",
    method: "input.simulate",
    description:
      "Inject input into the running game. events[] (required): {event_type, event_data?, delay_before_ms?, delay_after_ms?}. " +
      "Types: key|mouse_button|mouse_motion|action|click. click is a composite: press + 50ms delay + release. " +
      "Returns per-event results with index/total. summary (default true) returns last_event only; false returns full results array.",
    inputSchema: {
      events: z
        .array(
          z.object({
            event_type: z.enum(["key", "mouse_button", "mouse_motion", "action", "click"]),
            event_data: z.record(z.string(), z.unknown()).optional(),
            delay_before_ms: z.number().int().nonnegative().optional(),
            delay_after_ms: z.number().int().nonnegative().optional(),
          }),
        )
        .min(1),
      summary: z.boolean().optional(),
    },
    annotations: { openWorldHint: false },
  },
  {
    name: "animation_player_control",
    method: "animation_player.control",
    description:
      "Drive an AnimationPlayer in the running game. operation: play|pause|stop|seek. Optional animation_name (play) or time (seek). Returns post-op state.",
    inputSchema: {
      node_path: z.string(),
      operation: z.enum(["play", "pause", "stop", "seek"]),
      animation_name: z.string().optional(),
      time: z.number().optional(),
    },
    annotations: { openWorldHint: false },
  },
  // game_eval is RCE-equivalent — gated via feature_gate. Plugin-side
  // FeatureGate (feature_gate.gd) performs the full dual-gate check as
  // defence-in-depth; the gate here only controls MCP-catalogue exposure.
  {
    name: "game_eval",
    method: "game.eval",
    description:
      "DANGER: runs arbitrary GDScript in game. Prefer input_simulate, runtime_get_node_state, or signal_emit for safer alternatives.",
    inputSchema: { code: z.string(), scope_path: z.string().optional() },
    annotations: { destructiveHint: true, openWorldHint: false },
    gate: "game_eval",
  },
];

// ── Registration ─────────────────────────────────────────────────────

// NOTE: All runtime-group tools (runtime_screenshot, runtime_get_node_state,
// debugger_get_log, input_simulate, animation_player_control) are registered
// by groups.ts with custom handlers (multi-content screenshots, summary-first
// logs). This register() only runs for tools that pass through moduleAllowed
// — i.e., tools NOT in GROUP_TOOL_NAMES. Gated tools (game_eval) are
// skipped here when their gate is closed; registerStubs covers them.
export function register(server: McpServer, bridge: Bridge, allowedTools: Set<string> | null = null): void {
  for (const tool of runtimeTools) {
    if (allowedTools && !allowedTools.has(tool.name)) continue;
    if (tool.gate && !isEnabled(tool.gate)) continue;
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations },
      (input: unknown) => callAndWrap(bridge, tool.method, input, { runtime: true }),
    );
  }
}
