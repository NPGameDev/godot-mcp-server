import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Bridge, Profile, callAndWrap, includesInProfile } from "../types.js";
import { ToolDef } from "./scene.js";

export const animationTools: ToolDef[] = [
  {
    name: "animation_add_key",
    method: "animation.add_key",
    description:
      "Insert/update a keyframe on AnimationPlayer track. Auto-creates value track if missing. UndoRedo-wrapped. Silent-return on exact-time duplicate.",
    inputSchema: {
      player_path: z.string(),
      animation_name: z.string(),
      track_path: z.string(),
      time: z.number(),
      value: z.unknown(),
      track_type: z.string().optional(),
    },
  },
  {
    name: "animation_remove_key",
    method: "animation.remove_key",
    description:
      "Remove a keyframe at exact time from an AnimationPlayer track. UndoRedo-wrapped. NOT_FOUND if no key at time.",
    inputSchema: {
      player_path: z.string(),
      animation_name: z.string(),
      track_path: z.string(),
      time: z.number(),
    },
  },
  {
    name: "animation_get_keys",
    method: "animation.get_keys",
    description:
      "List keys on an AnimationPlayer track: { time, value, transition }. Read-only; no auto-track-create.",
    inputSchema: {
      player_path: z.string(),
      animation_name: z.string(),
      track_path: z.string(),
    },
  },
];

export function register(server: McpServer, bridge: Bridge, profile: Profile = "full"): void {
  for (const tool of animationTools) {
    if (!includesInProfile(tool.name, profile)) continue;
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      (input: unknown) => callAndWrap(bridge, tool.method, input),
    );
  }
}
