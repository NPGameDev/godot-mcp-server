import { z } from "zod";
import type { ToolDef } from "../shared/types.js";
import { PROJECT_FILE_PATH } from "../security/pathGuard.js";

const frameSchema = z.object({
  texture: z.string().describe("res:// path to frame texture"),
  atlas: z
    .object({
      x: z.number().int(),
      y: z.number().int(),
      width: z.number().int(),
      height: z.number().int(),
    })
    .optional()
    .describe("Atlas region within the texture"),
  duration: z.number().optional().describe("Per-frame duration multiplier (default 1.0)"),
});

const animationSchema = z.object({
  name: z.string().describe("Animation name (e.g. 'idle', 'run')"),
  fps: z.number().optional().describe("Frames per second (default 5.0)"),
  loop: z.boolean().optional().describe("Loop animation (default true)"),
  frames: z.array(frameSchema).describe("Frame textures"),
});

export const spriteframesTools: ToolDef[] = [
  {
    name: "spriteframes_create",
    method: "spriteframes.create",
    description:
      "Create a SpriteFrames resource (.tres) with named animations and frame textures. For AnimatedSprite2D character/effect animation.",
    inputSchema: {
      file_path: z.string().describe("Output .tres file path (res://)"),
      animations: z.array(animationSchema).min(1).describe("Animations with their frames"),
    },
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false, destructiveHint: false },
    successHint: "Add/modify frames with spriteframes_edit. For spritesheets use spriteframes_from_spritesheet.",
    pathParams: [PROJECT_FILE_PATH],
  },
  {
    name: "spriteframes_edit",
    method: "spriteframes.edit",
    description:
      "Edit an existing SpriteFrames resource: add/remove animations, add/remove/reorder frames, adjust fps/loop. 'list' returns all animations.",
    inputSchema: {
      file_path: z.string().describe("Path to existing SpriteFrames .tres"),
      action: z
        .enum([
          "add_animation",
          "remove_animation",
          "add_frame",
          "remove_frame",
          "set_fps",
          "set_loop",
          "reorder_frames",
          "list",
        ])
        .describe("Edit operation"),
      animation_name: z.string().optional().describe("Target animation name"),
      fps: z.number().optional().describe("New FPS value (for set_fps)"),
      loop: z.boolean().optional().describe("New loop value (for set_loop)"),
      frames: z.array(frameSchema).optional().describe("Frames to add"),
      frame_index: z.number().int().optional().describe("Frame index (for remove/reorder)"),
      new_index: z.number().int().optional().describe("New position (for reorder)"),
    },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
    pathParams: [PROJECT_FILE_PATH],
  },
  {
    name: "spriteframes_from_spritesheet",
    method: "spriteframes.from_spritesheet",
    description:
      "Auto-slice a spritesheet into SpriteFrames animations by grid. Each animation maps to a row/column range in the sheet.",
    inputSchema: {
      file_path: z.string().describe("Output .tres file path"),
      texture_path: z.string().describe("Spritesheet texture path (res://)"),
      frame_size: z
        .object({
          x: z.number().int().describe("Frame width in pixels"),
          y: z.number().int().describe("Frame height in pixels"),
        })
        .describe("Size of each frame in the grid"),
      animations: z
        .array(
          z.object({
            name: z.string().describe("Animation name"),
            row: z.number().int().optional().describe("Row in spritesheet (0-indexed, default 0)"),
            start_col: z.number().int().optional().describe("Starting column (default 0)"),
            frame_count: z.number().int().describe("Number of frames"),
            fps: z.number().optional().describe("Frames per second"),
            loop: z.boolean().optional().describe("Loop this animation"),
          }),
        )
        .min(1)
        .describe("Animation definitions mapping to spritesheet regions"),
    },
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false, destructiveHint: false },
    // file_path is guarded; texture_path is NOT (toolkit calls load(), which is
    // res://-scoped — guarding it server-side could false-reject).
    pathParams: [PROJECT_FILE_PATH],
  },
];
