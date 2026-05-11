import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../types.js";
import { registerTools } from "../tool_helpers.js";

// input_map tools write to ProjectSettings (input/* keys). Ungated since
// project_set_setting can already write the same keys without a gate —
// these structured tools are safer than raw key-value writes.
export const inputMapTools: ToolDef[] = [
  {
    name: "input_map_action",
    method: "input_map.action",
    description:
      "Add or remove an InputMap action. " +
      "action: 'add' or 'remove' (the operation). " +
      "action_name: the input map name (e.g. 'jump', 'move_left'). " +
      "action='add' is idempotent with optional deadzone.",
    inputSchema: {
      action: z.enum(["add", "remove"]),
      action_name: z.string(),
      deadzone: z.number().optional(),
    },
    annotations: { idempotentHint: true, openWorldHint: false },
  },
  {
    name: "input_map_event",
    method: "input_map.event",
    description:
      "Bind/unbind an input event to an action. " +
      "action: 'bind' or 'unbind' (the operation). " +
      "event: object — {type:'key', keycode:'Space'}, {type:'mouse_button', button_index:1}. " +
      "action='bind' is idempotent.",
    inputSchema: {
      action: z.enum(["bind", "unbind"]),
      action_name: z.string(),
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
    annotations: { idempotentHint: true, openWorldHint: false },
  },
];

export function register(server: McpServer, bridge: Bridge, allowedTools: Set<string> | null = null): void {
  registerTools(server, bridge, inputMapTools, allowedTools);
}
