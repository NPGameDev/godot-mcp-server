import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../types.js";
import { callAndWrap } from "../types.js";

export const animationTools: ToolDef[] = [
  {
    name: "animation_keyframe",
    tier: "full",
    method: "animation.keyframe",
    description:
      "Add or remove a keyframe on an AnimationPlayer track. action='add' auto-creates value track; UndoRedo-wrapped; idempotent on exact-time duplicate.",
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
    tier: "full",
    method: "animation.get_keys",
    description:
      "List keys on an AnimationPlayer track: { time, value, transition }. Read-only; no auto-track-create.",
    inputSchema: {
      player_path: z.string(),
      animation_name: z.string(),
      track_path: z.string(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];

export function register(server: McpServer, bridge: Bridge, allowedTools: Set<string> | null = null): void {
  for (const tool of animationTools) {
    if (allowedTools && !allowedTools.has(tool.name)) continue;
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      },
      (input: unknown) => callAndWrap(bridge, tool.method, input),
    );
  }
}
