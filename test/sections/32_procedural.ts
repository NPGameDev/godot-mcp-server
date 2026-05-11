import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, assertGuard } from "../helpers.js";

export async function testProcedural(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  // ── Gradient: create with 3 color stops ──
  const gradResult = (await bridge.call(
    "procedural.edit_gradient",
    {
      file_path: "res://mcp_smoke_gradient.tres",
      action: "set",
      points: [
        { offset: 0.0, color: { r: 1, g: 0, b: 0 } },
        { offset: 0.5, color: { r: 0, g: 1, b: 0 } },
        { offset: 1.0, color: { r: 0, g: 0, b: 1 } },
      ],
    },
    CALL_TIMEOUT,
  )) as { success?: boolean; point_count?: number };

  if (gradResult?.success === true && gradResult.point_count === 3) {
    pass(`procedural.edit_gradient set -> point_count=${gradResult.point_count}`);
  } else {
    fail(`procedural.edit_gradient set: ${JSON.stringify(gradResult)}`);
  }

  // ── Curve: create with control points ──
  const curveResult = (await bridge.call(
    "procedural.edit_curve",
    {
      file_path: "res://mcp_smoke_curve.tres",
      action: "set",
      points: [
        { position: { x: 0, y: 0 } },
        { position: { x: 0.5, y: 1.0 }, left_tangent: 0, right_tangent: 0 },
        { position: { x: 1.0, y: 0 } },
      ],
    },
    CALL_TIMEOUT,
  )) as { success?: boolean; point_count?: number };

  if (curveResult?.success === true && curveResult.point_count === 3) {
    pass(`procedural.edit_curve set -> point_count=${curveResult.point_count}`);
  } else {
    fail(`procedural.edit_curve set: ${JSON.stringify(curveResult)}`);
  }

  // ── Noise: create FastNoiseLite ──
  const noiseResult = (await bridge.call(
    "procedural.edit_noise",
    {
      file_path: "res://mcp_smoke_noise.tres",
      noise_type: "simplex",
      frequency: 0.05,
      octaves: 4,
      fractal_type: "fbm",
    },
    CALL_TIMEOUT,
  )) as { success?: boolean; noise_type?: string };

  if (noiseResult?.success === true) {
    pass(`procedural.edit_noise -> noise_type=${noiseResult.noise_type}`);
  } else {
    fail(`procedural.edit_noise: ${JSON.stringify(noiseResult)}`);
  }

  // ── Guard: invalid noise_type ──
  assertGuard(
    ctx,
    "procedural.edit_noise invalid type",
    await bridge.call(
      "procedural.edit_noise",
      { file_path: "res://mcp_smoke_noise2.tres", noise_type: "invalid_noise" },
      CALL_TIMEOUT,
    ),
    "INVALID_PARAMS",
    ["invalid_noise", "noise_type"],
  );

  // ── Cleanup: delete created .tres files ──
  try {
    await bridge.call("file.delete", { path: "res://mcp_smoke_gradient.tres" }, CALL_TIMEOUT);
    await bridge.call("file.delete", { path: "res://mcp_smoke_curve.tres" }, CALL_TIMEOUT);
    await bridge.call("file.delete", { path: "res://mcp_smoke_noise.tres" }, CALL_TIMEOUT);
  } catch {
    /* noop */
  }
}
