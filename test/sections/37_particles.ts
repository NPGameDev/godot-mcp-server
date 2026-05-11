import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, assertGuard } from "../helpers.js";

export async function testParticles(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  // Happy path: 2D fire preset
  const fireResult = (await bridge.call(
    "particles.create",
    { parent_path: ".", type: "2d", preset: "fire", name: "MCPSmokeFire" },
    CALL_TIMEOUT,
  )) as { success?: boolean; node_path?: string; preset_applied?: string };

  if (fireResult?.success === true && fireResult.preset_applied === "fire") {
    pass(`particles.create 2D fire -> ${fireResult.node_path}`);
  } else {
    fail(`particles.create 2D fire: ${JSON.stringify(fireResult)}`);
  }

  // 3D explosion with mesh
  const explResult = (await bridge.call(
    "particles.create",
    { parent_path: ".", type: "3d", preset: "explosion", mesh: "quad", name: "MCPSmokeExplosion3D" },
    CALL_TIMEOUT,
  )) as { success?: boolean; type?: string };

  if (explResult?.success === true) {
    pass("particles.create 3D explosion with quad mesh");
  } else {
    fail(`particles.create 3D explosion: ${JSON.stringify(explResult)}`);
  }

  // Guard: invalid preset
  assertGuard(
    ctx,
    "particles.create invalid preset",
    await bridge.call("particles.create", { parent_path: ".", type: "2d", preset: "lava" }, CALL_TIMEOUT),
    "INVALID_PARAMS",
    "preset",
  );

  // Guard: invalid type
  assertGuard(
    ctx,
    "particles.create invalid type",
    await bridge.call("particles.create", { parent_path: ".", type: "4d" }, CALL_TIMEOUT),
    "INVALID_PARAMS",
    "type",
  );

  // Guard: non-existent parent
  assertGuard(
    ctx,
    "particles.create missing parent",
    await bridge.call("particles.create", { parent_path: "NonExistent", type: "2d" }, CALL_TIMEOUT),
    "NOT_FOUND",
    "parent",
  );

  // Cleanup
  try {
    await bridge.call("scene.delete_node", { node_path: "MCPSmokeFire" }, CALL_TIMEOUT);
    await bridge.call("scene.delete_node", { node_path: "MCPSmokeExplosion3D" }, CALL_TIMEOUT);
  } catch {
    /* noop */
  }
}
