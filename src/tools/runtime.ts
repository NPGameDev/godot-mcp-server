import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef, ToolTextResult } from "../types.js";
import {
  callAndWrap,
  registerTools,
  toolErrorFromPayload,
  runtimeErrorWithCrashContext,
  coercedBoolean,
} from "../tool_helpers.js";
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
      "Game output (needs running game — use editor_get_console after crash). " +
      "source='buffer'|'file'. limit=200. text_filter + is_regex for search.",
    inputSchema: {
      limit: z.coerce.number().int().positive().optional(),
      source: z.enum(["buffer", "file"]).optional(),
      text_filter: z
        .string()
        .optional()
        .describe("Substring to match against log message text (case-insensitive). Set is_regex=true for regex."),
      is_regex: coercedBoolean()
        .optional()
        .describe("Treat text_filter as a regex pattern instead of a plain substring (default false)."),
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
      "click_node takes {node_path} — calls grab_focus + emits pressed on BaseButtons (no coordinate guessing).\n\n" +
      "Mouse coordinate modes:\n" +
      "- position: {x, y} — raw viewport/screen coordinates (default). Use for UI elements (buttons, menus).\n" +
      "- world_position: {x, y} — game-world coordinates, auto-translated via canvas transform (accounts for camera offset and zoom). " +
      "Use for clicking at specific in-game locations.\n\n" +
      "Mouse events auto-focus the game window and route through push_input for CanvasLayer/GUI support. Returns per-event diagnostics.",
    inputSchema: {
      events: z.union([
        z.object({
          event_type: z.enum(["key", "mouse_button", "mouse_motion", "action", "click", "click_node"]),
          event_data: z.record(z.string(), z.unknown()).optional(),
          delay_before_ms: z.coerce.number().int().nonnegative().optional(),
          delay_after_ms: z.coerce.number().int().nonnegative().optional(),
        }),
        z
          .array(
            z.object({
              event_type: z.enum(["key", "mouse_button", "mouse_motion", "action", "click", "click_node"]),
              event_data: z.record(z.string(), z.unknown()).optional(),
              delay_before_ms: z.coerce.number().int().nonnegative().optional(),
              delay_after_ms: z.coerce.number().int().nonnegative().optional(),
            }),
          )
          .min(1),
      ]),
      summary: coercedBoolean().optional(),
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
      time: z.coerce.number().optional(),
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
  // I2 waiver: runtime_set_property description exceeds 200-char limit.
  // Inline examples eliminate the #1 agent confusion (F21/F33): reaching
  // for execute_code .set() when a purpose-built tool exists.
  {
    name: "runtime_set_property",
    method: "runtime.set_property",
    description:
      "Set a property on a node in the running game. " +
      "Requires a running game (use game_start first). " +
      "For editor-time scene editing, use node_set_property instead.\n\n" +
      "Examples:\n" +
      '  node_path: "/root/Main/Player", property: "speed", value: 400\n' +
      '  node_path: "/root/Main/Enemy", property: "health", value: 0\n' +
      '  node_path: "/root/Main/HUD/ScoreLabel", property: "text", value: "Score: 999"',
    inputSchema: {
      node_path: z.string().describe("Absolute path to the node in the running scene tree"),
      property: z.string().describe("Property name (supports compound paths like 'position:x')"),
      value: z
        .union([z.string(), z.number(), z.boolean(), z.array(z.any()), z.record(z.string(), z.any())])
        .describe("Value to set — type is coerced to match the property's existing type"),
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
  },
  // execute_code is RCE-equivalent — gated via feature_gate. Plugin-side
  // FeatureGate (feature_gate.gd) performs the full dual-gate check as
  // defence-in-depth; the gate here only controls MCP-catalogue exposure.
  // I2 waiver: expression-only examples are the fix for F23/F32 — agents
  // repeatedly tried `score = 100` (assignment) and hit parse errors.
  {
    name: "execute_code",
    method: "execute.code",
    description:
      "DANGER: evaluates a GDScript expression. Expression-only — " +
      "no var/return/if/for statements, no = assignment.\n\n" +
      "context: 'game' (default) runs in the running game, 'editor' runs in the editor process.\n\n" +
      "To set properties: get_node('/root/Main/Player').set('speed', 400)\n" +
      "To call methods: get_node('/root/Main/Player').call('take_damage', 25)\n" +
      "To read values: get_node('/root/Main/Player').position\n\n" +
      "Prefer runtime_set_property for single property changes (safer, no expression syntax). " +
      "Use execute_code for complex multi-step operations or method calls with specific arguments. " +
      "If C# project, managed methods are callable at runtime (context:'game').",
    inputSchema: {
      code: z.string(),
      scope_path: z.string().optional(),
      context: z
        .enum(["game", "editor"])
        .optional()
        .describe("Execution context: 'game' for running game (default), 'editor' for editor process"),
    },
    annotations: { destructiveHint: true, openWorldHint: false },
    gate: "execute_code",
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
      return runtimeErrorWithCrashContext(bridge, err);
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
      return runtimeErrorWithCrashContext(bridge, e);
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
  // execute_code: alias "expression" → "code" (agents send the wrong param name),
  // route based on context param (game → runtime bridge, editor → editor bridge).
  handlers.set("execute_code", (input) => {
    if (!input.code && input.expression) {
      input.code = input.expression;
      delete input.expression;
    }
    const context = input.context ?? "game";
    if (context === "editor") {
      return callAndWrap(bridge, "execute.code", input);
    }
    return callAndWrap(bridge, "execute.code", input, { runtime: true });
  });
  // Default runtime handler for remaining tools
  for (const tool of runtimeTools) {
    if (!handlers.has(tool.name)) {
      handlers.set(tool.name, (input) => callAndWrap(bridge, tool.method, input, { runtime: true }));
    }
  }
  registerTools(server, bridge, runtimeTools, allowedTools ? allowedTools : null, { handlers });
}
