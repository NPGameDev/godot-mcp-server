import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../shared/types.js";
import { registerTools } from "../registration/toolRegistry.js";

// input_map tools write to ProjectSettings (input/* keys). Ungated since
// project_set_setting can already write the same keys — these structured
// tools are safer than raw key-value writes.
export const inputMapTools: ToolDef[] = [
  {
    name: "input_map_action",
    method: "input_map.action",
    description:
      "Add or remove an InputMap action. " +
      "action: 'add' or 'remove' (the operation). " +
      "name: the input map name (e.g. 'jump', 'move_left'). " +
      "action='add' is idempotent with optional deadzone.",
    inputSchema: {
      action: z.enum(["add", "remove"]),
      name: z.string(),
      deadzone: z.coerce.number().optional(),
    },
    annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false, destructiveHint: false },
    operationParam: "action",
    successHint: "Bind events with input_map_event after creating the action.",
  },
  // Deliberately detailed description: all 4 event types (key, mouse_button,
  // joypad_button, joypad_motion) need inline examples to avoid agent guesswork.
  {
    name: "input_map_event",
    method: "input_map.event",
    description:
      "Bind/unbind an input event to an action. " +
      "action: 'bind' or 'unbind' (the operation). " +
      "event: object — {type:'key', keycode:'Space'}, {type:'mouse_button', button_index:1}, " +
      "{type:'joypad_button', button_index:0}, {type:'joypad_motion', axis:0, axis_value:1.0}. " +
      "action='bind' is idempotent.",
    inputSchema: {
      action: z.enum(["bind", "unbind"]),
      name: z.string(),
      event: z.preprocess(
        (val) => {
          if (typeof val === "string") {
            try {
              return JSON.parse(val);
            } catch {
              return val;
            }
          }
          return val;
        },
        z.record(z.string(), z.unknown()),
      ),
    },
    annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false, destructiveHint: false },
    operationParam: "action",
  },
];

export function register(server: McpServer, bridge: Bridge, allowedTools?: Set<string>): void {
  registerTools(server, bridge, inputMapTools, allowedTools);
}
