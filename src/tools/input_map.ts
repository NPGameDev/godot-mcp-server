import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Bridge, Profile, callAndWrap, includesInProfile } from "../types.js";
import { ToolDef } from "./scene.js";

export const inputMapTools: ToolDef[] = [
  {
    name: "input_map_add_action",
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
    method: "input_map.remove_action",
    description:
      "Remove an InputMap action. Refuses built-in ui_* actions (would break editor nav). NOT_FOUND if missing.",
    inputSchema: { action: z.string() },
  },
];

export function register(server: McpServer, bridge: Bridge, profile: Profile = "full"): void {
  for (const tool of inputMapTools) {
    if (!includesInProfile(tool.name, profile)) continue;
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      (input: unknown) => callAndWrap(bridge, tool.method, input),
    );
  }
}
