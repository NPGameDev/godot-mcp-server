import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../shared/types.js";
import { registerTools } from "../registration/toolRegistry.js";

// The input_map write tools change ProjectSettings (input/* keys). Ungated since
// project_set_setting can already write the same keys — these structured
// tools are safer than raw key-value writes.
export const inputMapTools: ToolDef[] = [
  // The description carries the revert-arrow rule and the dotted-name rule, since an
  // agent reads can_revert and feature by them; it is on the catalogue's length waivers.
  {
    name: "input_map_list",
    method: "input_map.list",
    description:
      "List input actions and their events (read-only). " +
      "Without name: project actions plus the built-ins that differ from their default; " +
      "include_builtin adds the unchanged ones. " +
      "Returns {actions, count}; an entry has name, source ('builtin' or 'project'), deadzone, events and can_revert. " +
      "can_revert follows the editor's revert arrow: a built-in differs when its deadzone, its event count " +
      "or the event at any position differs (order counts, device and mouse pressed do not), " +
      "and default then holds the default deadzone and events. " +
      "A dotted name such as jump.macos is a feature override: feature is the part after the first dot, " +
      "and the entry applies only where OS.has_feature(tag) holds, so jump.editor replaces jump inside the editor. " +
      "A built-in's feature entry is read-only: every write refuses it, revert too, even when can_revert is true. " +
      "Events pass back to input_map_event as they are, unless their type is 'unknown'.",
    inputSchema: {
      name: z.string().optional().describe("Exact action name, built-in or not; an unknown name is NOT_FOUND"),
      include_builtin: z.boolean().optional().describe("Also list the unchanged built-in actions (default false)"),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "input_map_action",
    method: "input_map.action",
    description:
      "Add, remove, rename or revert an InputMap action. " +
      "name: the action (e.g. 'jump'). " +
      "'add' is idempotent, optional deadzone; 'rename' needs new_name; 'revert' puts a built-in back to its default.",
    inputSchema: {
      action: z
        .enum(["add", "remove", "rename", "revert"])
        .describe(
          "'revert' also removes a project.godot line that only matches the default's content, and answers " +
            "the input_map_list entry with status 'reverted', or 'returned' when there was no line to remove",
        ),
      name: z.string(),
      deadzone: z.coerce.number().optional(),
      new_name: z.string().optional(),
    },
    annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false, destructiveHint: false },
    operationParam: "action",
    successHint: "Bind events with input_map_event after creating the action.",
    operationHints: {
      rename:
        "The action kept its events and deadzone. This tool does not update scripts or scenes that use the old name.",
      remove: "This tool does not update scripts or scenes that still use this action's name.",
      revert: "project.godot no longer has a line for this action.",
    },
  },
  // Deliberately detailed description: all 4 event types (key, mouse_button,
  // joypad_button, joypad_motion) need inline examples to avoid agent guesswork.
  // `event` stays an open record: the toolkit validates the shape, and a stripping
  // schema would drop a field (mouse `pressed`) before the toolkit could warn about it.
  {
    name: "input_map_event",
    method: "input_map.event",
    description:
      "Bind or unbind an input event on an action. " +
      "action: 'bind' (idempotent) or 'unbind'. " +
      "event: {type:'key', keycode:'Space'}, {type:'mouse_button', button_index:1}, " +
      "{type:'joypad_button', button_index:0}, {type:'joypad_motion', axis:0, axis_value:1.0}. " +
      "A key takes key_kind ('physical_keycode' default, 'keycode', 'key_label') and location (1 left, 2 right; Godot 4.3+). " +
      "A key or mouse_button takes shift, ctrl, alt, meta and command_or_control (Ctrl, or Cmd on macOS; ctrl and meta " +
      "are then ignored); a mouse_button also takes double_click. " +
      "Every event takes device; an unbind without one matches any device. " +
      "An event read from input_map_list passes back as it is, unless its type is 'unknown'. " +
      "warnings lists the fields that were ignored.",
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
