import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, assertGuard } from "../helpers.js";

export const TOOLS_TESTED: string[] = ["layer_names_set", "layer_names_get"];
export async function testLayerNames(ctx: TestCtx): Promise<void> {
  const { bridge, pass } = ctx;

  // Happy path: set 3 layer names for 2d_physics, then get and verify.
  const setResult = (await bridge.call(
    "project.set_layer_names",
    {
      category: "2d_physics",
      layers: { "1": "Ground", "2": "Player", "5": "Enemies" },
    },
    CALL_TIMEOUT,
  )) as { success?: boolean; layers_set?: number };

  if (setResult?.success !== true || setResult.layers_set !== 3)
    ctx.fail(`project.set_layer_names: ${JSON.stringify(setResult)}`);
  else pass(`project.set_layer_names 2d_physics -> layers_set=${setResult.layers_set}`);

  const getResult = (await bridge.call("project.get_layer_names", { category: "2d_physics" }, CALL_TIMEOUT)) as {
    success?: boolean;
    category?: string;
    layers?: Record<string, string>;
  };

  if (getResult?.success !== true) {
    ctx.fail(`project.get_layer_names: ${JSON.stringify(getResult)}`);
  } else {
    const layers = getResult.layers ?? {};
    // Keys come back as integers from the plugin; bridge serialises as strings.
    const ground = layers["1"] ?? layers[1 as unknown as string];
    const player = layers["2"] ?? layers[2 as unknown as string];
    const enemies = layers["5"] ?? layers[5 as unknown as string];
    if (ground === "Ground" && player === "Player" && enemies === "Enemies")
      pass("project.get_layer_names round-trip matches");
    else ctx.fail(`project.get_layer_names mismatch: ${JSON.stringify(layers)}`);
  }

  // Guard: invalid category.
  assertGuard(
    ctx,
    "project.set_layer_names invalid category",
    await bridge.call("project.set_layer_names", { category: "invalid", layers: { "1": "X" } }, CALL_TIMEOUT),
    "INVALID_PARAMS",
    "invalid category",
  );

  assertGuard(
    ctx,
    "project.get_layer_names invalid category",
    await bridge.call("project.get_layer_names", { category: "invalid" }, CALL_TIMEOUT),
    "INVALID_PARAMS",
    "invalid category",
  );

  // Cleanup: clear the layer names we set.
  try {
    await bridge.call(
      "project.set_layer_names",
      { category: "2d_physics", layers: { "1": "", "2": "", "5": "" } },
      CALL_TIMEOUT,
    );
  } catch {
    /* noop */
  }
}
