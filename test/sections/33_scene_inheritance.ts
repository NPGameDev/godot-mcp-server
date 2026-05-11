import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, assertGuard } from "../helpers.js";

export async function testSceneInheritance(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  // Setup: create a base scene with a Node2D root
  const baseResult = (await bridge.call(
    "scene.create",
    { file_path: "res://mcp_smoke_base_scene.tscn", root_type: "Node2D" },
    CALL_TIMEOUT,
  )) as { success?: boolean };
  if (!baseResult?.success) {
    fail(`scene_inheritance setup: create base scene failed: ${JSON.stringify(baseResult)}`);
    return;
  }

  // Happy path: create inherited scene (auto root name from base)
  const inheritResult = (await bridge.call(
    "scene.create_inherited",
    {
      file_path: "res://mcp_smoke_inherited_scene.tscn",
      base_scene: "res://mcp_smoke_base_scene.tscn",
    },
    CALL_TIMEOUT,
  )) as {
    success?: boolean;
    file_path?: string;
    base_scene?: string;
    root_name?: string;
  };

  if (inheritResult?.success === true && inheritResult.root_name === "mcp_smoke_base_scene") {
    pass(`scene.create_inherited -> root_name=${inheritResult.root_name}, base=${inheritResult.base_scene}`);
  } else {
    fail(`scene.create_inherited: ${JSON.stringify(inheritResult)}`);
  }

  // Happy path with custom root name
  const customResult = (await bridge.call(
    "scene.create_inherited",
    {
      file_path: "res://mcp_smoke_inherited_custom.tscn",
      base_scene: "res://mcp_smoke_base_scene.tscn",
      root_name: "SlimeEnemy",
    },
    CALL_TIMEOUT,
  )) as { success?: boolean; root_name?: string };

  if (customResult?.success === true && customResult.root_name === "SlimeEnemy") {
    pass(`scene.create_inherited custom root -> root_name=${customResult.root_name}`);
  } else {
    fail(`scene.create_inherited custom root: ${JSON.stringify(customResult)}`);
  }

  // Idempotency: calling again on same file returns status "returned"
  const idempResult = (await bridge.call(
    "scene.create_inherited",
    {
      file_path: "res://mcp_smoke_inherited_scene.tscn",
      base_scene: "res://mcp_smoke_base_scene.tscn",
    },
    CALL_TIMEOUT,
  )) as { success?: boolean; status?: string };

  if (idempResult?.success === true && idempResult.status === "returned") {
    pass(`scene.create_inherited idempotent -> status=${idempResult.status}`);
  } else {
    fail(`scene.create_inherited idempotent: expected status='returned', got ${JSON.stringify(idempResult)}`);
  }

  // Guard: non-existent base scene
  assertGuard(
    ctx,
    "scene.create_inherited missing base guard",
    await bridge.call(
      "scene.create_inherited",
      {
        file_path: "res://mcp_smoke_should_not_exist.tscn",
        base_scene: "res://does_not_exist.tscn",
      },
      CALL_TIMEOUT,
    ),
    "NOT_FOUND",
    "base scene",
  );

  // Cleanup: delete test scene files
  try {
    await bridge.call("file.delete", { path: "res://mcp_smoke_inherited_scene.tscn" }, CALL_TIMEOUT);
    await bridge.call("file.delete", { path: "res://mcp_smoke_inherited_custom.tscn" }, CALL_TIMEOUT);
    await bridge.call("file.delete", { path: "res://mcp_smoke_base_scene.tscn" }, CALL_TIMEOUT);
  } catch {
    /* noop */
  }
}
