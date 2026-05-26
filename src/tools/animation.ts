import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../types.js";
import { registerTools } from "../tool_helpers.js";

export const animationTools: ToolDef[] = [
  {
    name: "animation_keyframe",
    method: "animation.keyframe",
    description:
      "Add/remove a keyframe on an existing animation's track. animation must already exist; action='add' auto-creates the track only. Idempotent on exact-time dup.",
    inputSchema: {
      action: z.enum(["add", "remove"]),
      player_path: z.string(),
      animation_name: z.string(),
      track_path: z.string(),
      time: z.coerce.number(),
      value: z.unknown().optional().describe("Required for action='add'."),
      track_type: z.string().optional(),
    },
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false, destructiveHint: false },
    successHint: "Verify keys with animation_get_keys. Configure AnimationTree with animationtree_edit.",
  },
  {
    name: "animation_get_keys",
    method: "animation.get_keys",
    description: "List keys on an AnimationPlayer track: { time, value, transition }. Read-only; no auto-track-create.",
    inputSchema: {
      player_path: z.string(),
      animation_name: z.string(),
      track_path: z.string(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "animationtree_edit",
    method: "animationtree.edit",
    description:
      "Configure AnimationTree state machines: set root, add/remove nodes and transitions, set properties, or list structure.",
    inputSchema: {
      node_path: z.string().describe("Path to an AnimationTree node in the edited scene."),
      action: z
        .enum(["set_root", "add_node", "remove_node", "add_transition", "remove_transition", "set_property", "list"])
        .describe("Operation to perform on the AnimationTree."),
      root_type: z
        .enum(["AnimationNodeStateMachine", "AnimationNodeBlendTree"])
        .optional()
        .describe("For set_root: type of root node to create."),
      node_name: z.string().optional().describe("For add_node/remove_node: name of the state machine node."),
      node_type: z
        .string()
        .optional()
        .describe("For add_node: AnimationNode subclass (e.g. AnimationNodeAnimation, AnimationNodeBlendSpace2D)."),
      animation_name: z
        .string()
        .optional()
        .describe("For add_node with AnimationNodeAnimation: which animation to play."),
      position: z
        .object({ x: z.number(), y: z.number() })
        .optional()
        .describe("For add_node: graph position { x, y }."),
      from: z.string().optional().describe("For transitions: source node name."),
      to: z.string().optional().describe("For transitions: destination node name."),
      switch_mode: z
        .enum(["immediate", "sync", "at_end"])
        .optional()
        .describe("For add_transition: when the transition fires."),
      advance_condition: z.string().optional().describe("For add_transition: condition name for conditional advance."),
      advance_mode: z
        .enum(["disabled", "enabled", "auto"])
        .optional()
        .describe("For add_transition: advance mode (disabled=0, enabled=1, auto=2)."),
      target_node: z.string().optional().describe("For set_property: node name in the state machine."),
      property: z.string().optional().describe("For set_property: property name to set."),
      value: z.unknown().optional().describe("For set_property: value to assign."),
    },
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false, destructiveHint: false },
  },
];

export function register(server: McpServer, bridge: Bridge, allowedTools: Set<string> | null = null): void {
  registerTools(server, bridge, animationTools, allowedTools);
}
