import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, assertGuard } from "../helpers.js";

export async function testNavigation(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  // Create a NavigationRegion2D node for testing
  const addResult = (await bridge.call(
    "scene.add_node",
    { parent_path: ".", type: "NavigationRegion2D", name: "MCPSmokeNavRegion" },
    CALL_TIMEOUT,
  )) as { success?: boolean };

  if (!addResult?.success) {
    fail(`navigation setup: could not add NavigationRegion2D: ${JSON.stringify(addResult)}`);
    return;
  }

  // Happy path: set outlines (rectangle)
  const setResult = (await bridge.call(
    "navigation.edit_polygon",
    {
      node_path: "MCPSmokeNavRegion",
      action: "set",
      outlines: [
        [
          { x: 0, y: 0 },
          { x: 500, y: 0 },
          { x: 500, y: 500 },
          { x: 0, y: 500 },
        ],
      ],
    },
    CALL_TIMEOUT,
  )) as { success?: boolean; outline_count?: number; vertex_count?: number };

  if (setResult?.success === true && setResult.outline_count === 1) {
    pass(`navigation set outlines -> outline_count=${setResult.outline_count}, vertex_count=${setResult.vertex_count}`);
  } else {
    fail(`navigation set outlines: ${JSON.stringify(setResult)}`);
  }

  // Bake the nav mesh
  const bakeResult = (await bridge.call(
    "navigation.edit_polygon",
    { node_path: "MCPSmokeNavRegion", action: "bake" },
    CALL_TIMEOUT,
  )) as { success?: boolean; polygon_count?: number };

  if (bakeResult?.success === true && typeof bakeResult.polygon_count === "number") {
    pass(`navigation bake -> polygon_count=${bakeResult.polygon_count}`);
  } else {
    fail(`navigation bake: ${JSON.stringify(bakeResult)}`);
  }

  // Guard: wrong node class
  assertGuard(
    ctx,
    "navigation wrong class guard",
    await bridge.call(
      "navigation.edit_polygon",
      {
        node_path: ".",
        action: "set",
        outlines: [
          [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 0, y: 1 },
          ],
        ],
      },
      CALL_TIMEOUT,
    ),
    "INVALID_CLASS",
    "NavigationRegion2D",
  );

  // Cleanup
  try {
    await bridge.call("scene.delete_node", { node_path: "MCPSmokeNavRegion" }, CALL_TIMEOUT);
  } catch {
    /* noop */
  }
}
