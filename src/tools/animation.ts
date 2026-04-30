import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../types.js";
import { registerTools } from "../tool_helpers.js";

export const animationTools: ToolDef[] = [
  {
    name: "animation_keyframe",
    method: "animation.keyframe",
    description:
      "Add/remove a keyframe on an existing animation's track. animation must already exist; action='add' auto-creates the track only. UndoRedo-wrapped; idempotent on exact-time dup.",
    inputSchema: {
      action: z.enum(["add", "remove"]),
      player_path: z.string(),
      animation_name: z.string(),
      track_path: z.string(),
      time: z.number(),
      value: z.unknown().optional().describe("Required for action='add'."),
      track_type: z.string().optional(),
    },
    annotations: { idempotentHint: true, openWorldHint: false },
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
];

export function register(server: McpServer, bridge: Bridge, allowedTools: Set<string> | null = null): void {
  registerTools(server, bridge, animationTools, allowedTools);
}
