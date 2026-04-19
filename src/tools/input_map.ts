import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, Profile, ToolDef } from "../types.js";
import { callAndWrap } from "../types.js";
import { isEnabled } from "../feature_gate.js";

// All 4 input_map mutators share a single gate (input_map_write).
// Plugin-side FeatureGate performs the full check as defence-in-depth;
// this controls MCP catalogue visibility only.
export const inputMapTools: ToolDef[] = [];

if (isEnabled("input_map_write")) {
  inputMapTools.push(
    {
      name: "input_map_add_action",
      tier: "full",
      method: "input_map.add_action",
      description:
        "Register an InputMap action with deadzone. Idempotent: status created on fresh, returned if action exists (reports existing deadzone).",
      inputSchema: {
        action: z.string(),
        deadzone: z.number().optional(),
      },
    },
    {
      name: "input_map_action_add_event",
      tier: "full",
      method: "input_map.action_add_event",
      description:
        "Bind an event (key / mouse_button / joypad_button / joypad_motion dict) to an action. Silent-return on equivalent-event duplicate.",
      inputSchema: {
        action: z.string(),
        event: z.record(z.string(), z.unknown()),
      },
    },
    {
      name: "input_map_action_remove_event",
      tier: "full",
      method: "input_map.action_remove_event",
      description:
        "Unbind an event from an action (matching via type + indices + modifiers). NOT_FOUND if no match.",
      inputSchema: {
        action: z.string(),
        event: z.record(z.string(), z.unknown()),
      },
    },
    {
      name: "input_map_remove_action",
      tier: "full",
      method: "input_map.remove_action",
      description:
        "Remove an InputMap action. Refuses built-in ui_* actions (would break editor nav). NOT_FOUND if missing.",
      inputSchema: { action: z.string() },
    },
  );
}

export function register(server: McpServer, bridge: Bridge, profile: Profile = "full"): void {
  for (const tool of inputMapTools) {
    if (profile === "lite" && tool.tier !== "lite") continue;
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      (input: unknown) => callAndWrap(bridge, tool.method, input),
    );
  }
}
