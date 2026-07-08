import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, assertGuard } from "../helpers.js";

export const TOOLS_TESTED: string[] = [
  "spriteframes_create",
  "spriteframes_edit",
  "spriteframes_from_spritesheet",
  "file_delete",
];
export async function testSpriteframes(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  // Happy path: create SpriteFrames with 2 animations
  const createResult = (await bridge.call(
    "spriteframes.create",
    {
      file_path: "res://mcp_smoke_spriteframes.tres",
      animations: [
        {
          name: "idle",
          fps: 8,
          loop: true,
          frames: [{ texture_path: "res://icon.svg" }, { texture_path: "res://icon.svg", duration: 1.5 }],
        },
        {
          name: "run",
          fps: 12,
          frames: [
            { texture_path: "res://icon.svg" },
            { texture_path: "res://icon.svg" },
            { texture_path: "res://icon.svg" },
          ],
        },
      ],
    },
    CALL_TIMEOUT,
  )) as { success?: boolean; animations?: { name: string; frame_count: number }[] };

  if (createResult?.success === true && createResult.animations?.length === 2) {
    pass(`spriteframes.create -> ${createResult.animations.length} animations`);
  } else {
    fail(`spriteframes.create: ${JSON.stringify(createResult)}`);
  }

  // Edit: add an animation
  const editResult = (await bridge.call(
    "spriteframes.edit",
    {
      file_path: "res://mcp_smoke_spriteframes.tres",
      action: "add_animation",
      animation_name: "jump",
      fps: 6,
    },
    CALL_TIMEOUT,
  )) as { success?: boolean };

  if (editResult?.success === true) {
    pass("spriteframes.edit add_animation jump");
  } else {
    fail(`spriteframes.edit add_animation: ${JSON.stringify(editResult)}`);
  }

  // from_spritesheet using icon.svg with small frame size
  const sheetResult = (await bridge.call(
    "spriteframes.from_spritesheet",
    {
      file_path: "res://mcp_smoke_spritesheet_frames.tres",
      texture_path: "res://icon.svg",
      frame_size: { x: 32, y: 32 },
      animations: [{ name: "walk", row: 0, frame_count: 2, fps: 8 }],
    },
    CALL_TIMEOUT,
  )) as { success?: boolean; animations?: unknown[] };

  if (sheetResult?.success === true) {
    pass("spriteframes.from_spritesheet -> created");
  } else {
    fail(`spriteframes.from_spritesheet: ${JSON.stringify(sheetResult)}`);
  }

  // Guard: empty frames
  assertGuard(
    ctx,
    "spriteframes.create empty animations guard",
    await bridge.call("spriteframes.create", { file_path: "res://mcp_smoke_bad.tres", animations: [] }, CALL_TIMEOUT),
    "INVALID_PARAMS",
    "animations",
  );

  // Guard: non-existent texture
  assertGuard(
    ctx,
    "spriteframes.create missing texture guard",
    await bridge.call(
      "spriteframes.create",
      {
        file_path: "res://mcp_smoke_bad2.tres",
        animations: [{ name: "x", frames: [{ texture_path: "res://no_such_texture.png" }] }],
      },
      CALL_TIMEOUT,
    ),
    "NOT_FOUND",
    "texture",
  );

  // Cleanup
  try {
    await bridge.call("file.delete", { file_path: "res://mcp_smoke_spriteframes.tres" }, CALL_TIMEOUT);
    await bridge.call("file.delete", { file_path: "res://mcp_smoke_spritesheet_frames.tres" }, CALL_TIMEOUT);
  } catch {
    /* noop */
  }
}
