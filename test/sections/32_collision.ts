import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, assertGuard } from "../helpers.js";

export const TOOLS_TESTED: string[] = [
  "scene_create_node",
  "scene_delete_node",
  "node_set_property",
  "collision_from_texture",
];
export async function testCollision(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  // Setup: create a Sprite2D with the Godot icon texture
  const createResult = (await bridge.call(
    "scene.create_node",
    { parent_path: ".", node_name: "MCPSmokeCollSprite", class_name: "Sprite2D" },
    CALL_TIMEOUT,
  )) as { success?: boolean };
  if (!createResult?.success) {
    fail(`collision setup: create Sprite2D failed: ${JSON.stringify(createResult)}`);
    return;
  }

  // Set the texture to Godot's icon
  const setTexResult = (await bridge.call(
    "node.set_property",
    { node_path: "MCPSmokeCollSprite", property: "texture", value: { type: "Resource", path: "res://icon.svg" } },
    CALL_TIMEOUT,
  )) as { success?: boolean };
  if (!setTexResult?.success) {
    fail(`collision setup: set texture failed: ${JSON.stringify(setTexResult)}`);
    try {
      await bridge.call("scene.delete_node", { node_path: "MCPSmokeCollSprite" }, CALL_TIMEOUT);
    } catch {
      /* noop */
    }
    return;
  }

  // Happy path: generate collision from texture
  const collResult = (await bridge.call(
    "node.collision_from_sprite",
    { sprite_path: "MCPSmokeCollSprite", simplification: 2.0 },
    CALL_TIMEOUT,
  )) as { success?: boolean; polygon_count?: number; total_points?: number; path?: string };

  if (collResult?.success === true && (collResult.polygon_count ?? 0) > 0) {
    pass(
      `collision_from_texture -> polygon_count=${collResult.polygon_count}, total_points=${collResult.total_points}`,
    );
  } else {
    fail(`collision_from_texture: ${JSON.stringify(collResult)}`);
  }

  // Guard: non-sprite node (scene root is not a Sprite2D)
  assertGuard(
    ctx,
    "collision_from_texture non-sprite guard",
    await bridge.call("node.collision_from_sprite", { sprite_path: "." }, CALL_TIMEOUT),
    "INVALID_CLASS",
    "Sprite2D",
  );

  // Cleanup: delete the sprite and any collision siblings
  try {
    await bridge.call("scene.delete_node", { node_path: "MCPSmokeCollSprite" }, CALL_TIMEOUT);
  } catch {
    /* noop */
  }
  try {
    await bridge.call("scene.delete_node", { node_path: "MCPSmokeCollSprite_collision" }, CALL_TIMEOUT);
  } catch {
    /* noop */
  }
}
