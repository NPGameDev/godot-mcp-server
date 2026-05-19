import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, assertGuard } from "../helpers.js";

export const TOOLS_TESTED: string[] = [
  "scene_create_node",
  "scene_delete_node",
  "3d_create_primitive",
  "3d_setup_environment",
  "3d_create_light",
  "3d_create_camera",
];
export async function test3dTools(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  // ── Setup: create a Node3D root to parent everything under ──
  const rootResult = (await bridge.call(
    "scene.create_node",
    { class_name: "Node3D", node_name: "MCPSmoke3D", parent_path: "." },
    CALL_TIMEOUT,
  )) as { success?: boolean; path?: string };
  if (!rootResult?.success) {
    fail(`3d_tools setup (create Node3D root): ${JSON.stringify(rootResult)}`);
    return;
  }

  // ── 3d.create_primitive box with material ──
  const boxResult = (await bridge.call(
    "3d.create_primitive",
    {
      parent_path: "MCPSmoke3D",
      primitive: "box",
      name: "SmokeBox",
      size: { x: 2, y: 2, z: 2 },
      material: {
        type: "StandardMaterial3D",
        albedo_color: { r: 0.8, g: 0.2, b: 0.2 },
        metallic: 0.5,
        roughness: 0.3,
      },
    },
    CALL_TIMEOUT,
  )) as { success?: boolean; path?: string };
  if (boxResult?.success === true && boxResult.path?.includes("SmokeBox")) {
    pass(`3d.create_primitive box -> path=${boxResult.path}`);
  } else {
    fail(`3d.create_primitive box: ${JSON.stringify(boxResult)}`);
  }

  // ── 3d.create_primitive sphere (no material) ──
  const sphereResult = (await bridge.call(
    "3d.create_primitive",
    {
      parent_path: "MCPSmoke3D",
      primitive: "sphere",
      name: "SmokeSphere",
    },
    CALL_TIMEOUT,
  )) as { success?: boolean; path?: string };
  if (sphereResult?.success === true) {
    pass(`3d.create_primitive sphere -> path=${sphereResult.path}`);
  } else {
    fail(`3d.create_primitive sphere: ${JSON.stringify(sphereResult)}`);
  }

  // ── 3d.setup_environment ──
  const envResult = (await bridge.call(
    "3d.setup_environment",
    {
      parent_path: "MCPSmoke3D",
      sky: { type: "ProceduralSkyMaterial" },
      ambient_light: { energy: 0.5 },
      tonemap: "filmic",
    },
    CALL_TIMEOUT,
  )) as { success?: boolean; path?: string };
  if (envResult?.success === true && envResult.path?.includes("WorldEnvironment")) {
    pass(`3d.setup_environment -> path=${envResult.path}`);
  } else {
    fail(`3d.setup_environment: ${JSON.stringify(envResult)}`);
  }

  // ── 3d.create_light directional with shadow ──
  const lightResult = (await bridge.call(
    "3d.create_light",
    {
      parent_path: "MCPSmoke3D",
      light_type: "directional",
      name: "SmokeLight",
      shadow: true,
      rotation: { x: -45, y: 30, z: 0 },
    },
    CALL_TIMEOUT,
  )) as { success?: boolean; path?: string };
  if (lightResult?.success === true && lightResult.path?.includes("SmokeLight")) {
    pass(`3d.create_light directional -> path=${lightResult.path}`);
  } else {
    fail(`3d.create_light directional: ${JSON.stringify(lightResult)}`);
  }

  // ── 3d.create_camera perspective ──
  const camResult = (await bridge.call(
    "3d.create_camera",
    {
      parent_path: "MCPSmoke3D",
      name: "SmokeCam",
      projection: "perspective",
      fov: 75,
      position: { x: 0, y: 5, z: 10 },
      current: true,
    },
    CALL_TIMEOUT,
  )) as { success?: boolean; path?: string };
  if (camResult?.success === true && camResult.path?.includes("SmokeCam")) {
    pass(`3d.create_camera perspective -> path=${camResult.path}`);
  } else {
    fail(`3d.create_camera perspective: ${JSON.stringify(camResult)}`);
  }

  // ── Guard: invalid primitive type ──
  assertGuard(
    ctx,
    "3d.create_primitive invalid primitive",
    await bridge.call("3d.create_primitive", { parent_path: "MCPSmoke3D", primitive: "invalid_shape" }, CALL_TIMEOUT),
    "INVALID_PARAMS",
    ["invalid_shape", "primitive"],
  );

  // ── Cleanup ──
  try {
    await bridge.call("scene.delete_node", { node_path: "MCPSmoke3D" }, CALL_TIMEOUT);
  } catch {
    /* noop */
  }
}
