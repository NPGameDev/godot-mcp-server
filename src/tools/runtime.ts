import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef, ToolTextResult } from "../types.js";
import { callAndWrap, registerTools, toolErrorFromPayload, toolErrorFromException } from "../tool_helpers.js";
import { stableStringify } from "../schema_min.js";

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
      "Capture the running game window. Requires an active playtest (game_start). Use editor_screenshot for the editor viewport. Returns inline PNG.",
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
      "Inject input into the running game. events: single {event_type, event_data?, delay_before_ms?, delay_after_ms?} for one action, " +
      "or an array for a sequence of actions (prefer a single call with multiple events over separate calls). " +
      "Types: key|mouse_button|mouse_motion|action|click|click_node. click is a composite: auto-focus + warp_mouse + press + 50ms delay + release via push_input (GUI-safe). " +
      "click_node takes {node_path} — calls grab_focus + emits pressed on BaseButtons (no coordinate guessing). " +
      "Mouse position: {x, y} flat or {position:{x,y}} nested. " +
      "Mouse events auto-focus the game window and route through push_input for CanvasLayer/GUI support. Returns per-event diagnostics.",
    inputSchema: {
      events: z.union([
        z.object({
          event_type: z.enum(["key", "mouse_button", "mouse_motion", "action", "click", "click_node"]),
          event_data: z.record(z.string(), z.unknown()).optional(),
          delay_before_ms: z.number().int().nonnegative().optional(),
          delay_after_ms: z.number().int().nonnegative().optional(),
        }),
        z
          .array(
            z.object({
              event_type: z.enum(["key", "mouse_button", "mouse_motion", "action", "click", "click_node"]),
              event_data: z.record(z.string(), z.unknown()).optional(),
              delay_before_ms: z.number().int().nonnegative().optional(),
              delay_after_ms: z.number().int().nonnegative().optional(),
            }),
          )
          .min(1),
      ]),
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
  {
    name: "runtime_get_script_vars",
    method: "runtime.get_script_vars",
    description:
      "Get script variables (names, values, public/private) for a live game node. Complements runtime_get_node_state (engine props only). visibility param filters.",
    inputSchema: {
      node_path: z.string(),
      visibility: z.enum(["public", "private", "all"]).optional().default("all"),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  // game_eval is RCE-equivalent — gated via feature_gate. Plugin-side
  // FeatureGate (feature_gate.gd) performs the full dual-gate check as
  // defence-in-depth; the gate here only controls MCP-catalogue exposure.
  {
    name: "game_eval",
    method: "game.eval",
    description:
      "DANGER: evaluates a GDScript expression in the running game. Expression-only — no var/return/if/for statements. " +
      "Use method calls (node.method()), property reads (node.property), or arithmetic. " +
      "Prefer input_simulate, runtime_get_node_state, or click_node. If C# project, managed methods are callable at runtime.",
    inputSchema: { code: z.string(), scope_path: z.string().optional() },
    annotations: { destructiveHint: true, openWorldHint: false },
    gate: "game_eval",
  },
];

// ── Custom handlers ─────────────────────────────────────────────────
// Promoted tools (runtime_screenshot, input_simulate, runtime_get_script_vars,
// debugger_get_log) have custom response processing. The remaining 2 tools
// (runtime_get_node_state, animation_player_control) stay in the
// runtime_advanced group and are registered by groups.ts.

/** runtime_screenshot returns multi-content (image + text metadata). */
function runtimeScreenshotHandler(bridge: Bridge, method: string, input: unknown) {
  return (async () => {
    try {
      const result = await bridge.callRuntime(method, input);
      const err = toolErrorFromPayload(result);
      if (err) return err;
      const obj = result as { image_base64: string; mime_type: string; width: number; height: number; bytes: number };
      return {
        content: [
          { type: "image" as const, data: obj.image_base64, mimeType: obj.mime_type ?? "image/png" },
          {
            type: "text" as const,
            text: JSON.stringify({ width: obj.width, height: obj.height, bytes: obj.bytes }),
          },
        ],
      };
    } catch (err) {
      return toolErrorFromException(err);
    }
  })();
}

/** input_simulate normalizes a single event object to an array. */
function inputSimulateHandler(bridge: Bridge, method: string, input: unknown) {
  const parsed = input as Record<string, unknown>;
  if (parsed.events && !Array.isArray(parsed.events)) {
    parsed.events = [parsed.events];
  }
  return callAndWrap(bridge, method, parsed, { runtime: true });
}

/** debugger_get_log prefixes a line-count summary before the payload. */
function debuggerLogHandler(bridge: Bridge, method: string, input: unknown) {
  return (async () => {
    try {
      const result = await bridge.callRuntime(method, input);
      const err = toolErrorFromPayload(result);
      if (err) return err;
      const obj = result as Record<string, unknown>;
      const count = typeof obj.count === "number" ? obj.count : 0;
      const total = typeof obj.total === "number" ? obj.total : count;
      const summary = `${count} line${count !== 1 ? "s" : ""} (of ${total} total)`;
      const text = stableStringify({ _summary: summary, ...obj });
      return { content: [{ type: "text" as const, text }] };
    } catch (e) {
      return toolErrorFromException(e);
    }
  })();
}

// ── Registration ─────────────────────────────────────────────────────

export function register(server: McpServer, bridge: Bridge, allowedTools: Set<string> | null = null): void {
  const handlers = new Map<string, (input: Record<string, unknown>) => Promise<ToolTextResult>>();
  // Custom handlers for promoted tools
  handlers.set(
    "runtime_screenshot",
    (input) => runtimeScreenshotHandler(bridge, "runtime.screenshot", input) as Promise<ToolTextResult>,
  );
  handlers.set("input_simulate", (input) => inputSimulateHandler(bridge, "input.simulate", input));
  handlers.set(
    "debugger_get_log",
    (input) => debuggerLogHandler(bridge, "debugger.get_log", input) as Promise<ToolTextResult>,
  );
  // Default runtime handler for remaining tools
  for (const tool of runtimeTools) {
    if (!handlers.has(tool.name)) {
      handlers.set(tool.name, (input) => callAndWrap(bridge, tool.method, input, { runtime: true }));
    }
  }
  registerTools(server, bridge, runtimeTools, allowedTools ? allowedTools : null, { handlers });
}
