import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, assertGuard } from "../helpers.js";

export async function testPath2d(ctx: TestCtx): Promise<void> {
  const { bridge, pass } = ctx;

  // Setup: create a Path2D test node.
  const createResult = (await bridge.call(
    "scene.create_node",
    { parent: ".", name: "MCPSmokePath2D", type: "Path2D" },
    CALL_TIMEOUT,
  )) as { success?: boolean };
  if (!createResult?.success) {
    ctx.fail(`path2d setup: scene.create_node failed: ${JSON.stringify(createResult)}`);
    return;
  }

  // Happy path: set 4 points forming a loop.
  const setResult = (await bridge.call(
    "path2d.edit_curve",
    {
      node_path: "MCPSmokePath2D",
      action: "set",
      points: [
        { position: { x: 0, y: 0 } },
        { position: { x: 100, y: 0 }, out_handle: { x: 20, y: -20 } },
        { position: { x: 100, y: 100 } },
        { position: { x: 0, y: 100 }, in_handle: { x: -20, y: 20 } },
      ],
    },
    CALL_TIMEOUT,
  )) as { success?: boolean; point_count?: number; baked_length?: number };

  if (setResult?.success !== true || setResult.point_count !== 4) {
    ctx.fail(`path2d.edit_curve set: ${JSON.stringify(setResult)}`);
  } else if (typeof setResult.baked_length !== "number" || setResult.baked_length <= 0) {
    ctx.fail(`path2d.edit_curve set: baked_length should be > 0, got ${setResult.baked_length}`);
  } else {
    pass(`path2d.edit_curve set -> point_count=${setResult.point_count}, baked_length=${setResult.baked_length}`);
  }

  // Add a point at index 2.
  const addResult = (await bridge.call(
    "path2d.edit_curve",
    {
      node_path: "MCPSmokePath2D",
      action: "add",
      index: 2,
      points: [{ position: { x: 200, y: 200 } }],
    },
    CALL_TIMEOUT,
  )) as { success?: boolean; point_count?: number };

  if (addResult?.success !== true || addResult.point_count !== 5) {
    ctx.fail(`path2d.edit_curve add: expected point_count=5, got ${JSON.stringify(addResult)}`);
  } else {
    pass(`path2d.edit_curve add at index 2 -> point_count=${addResult.point_count}`);
  }

  // Remove point at index 0.
  const removeResult = (await bridge.call(
    "path2d.edit_curve",
    {
      node_path: "MCPSmokePath2D",
      action: "remove",
      index: 0,
    },
    CALL_TIMEOUT,
  )) as { success?: boolean; point_count?: number };

  if (removeResult?.success !== true || removeResult.point_count !== 4) {
    ctx.fail(`path2d.edit_curve remove: expected point_count=4, got ${JSON.stringify(removeResult)}`);
  } else {
    pass(`path2d.edit_curve remove index 0 -> point_count=${removeResult.point_count}`);
  }

  // Guard: call on a non-Path2D node.
  // Use the scene root (typically a Node2D, but not a Path2D).
  assertGuard(
    ctx,
    "path2d.edit_curve non-Path2D guard",
    await bridge.call("path2d.edit_curve", { node_path: ".", action: "clear" }, CALL_TIMEOUT),
    "INVALID_CLASS",
    "Path2D",
  );

  // Cleanup: delete the test node.
  try {
    await bridge.call("scene.delete_node", { node_path: "MCPSmokePath2D" }, CALL_TIMEOUT);
  } catch {
    /* noop */
  }
}
