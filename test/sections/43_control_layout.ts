import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, assertGuard } from "../helpers.js";

export const TOOLS_TESTED: string[] = ["control_set_layout"];

export async function testControlLayout(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  // ── control.set_layout ──
  const ctrlNode = (await bridge.call(
    "scene.create_node",
    { class_name: "Control", parent_path: ".", node_name: "MCPSmokeCtrl" },
    CALL_TIMEOUT,
  )) as { status?: string; path?: string };
  const ctrlPath = ctrlNode?.path ?? "MCPSmokeCtrl";

  if (ctrlNode?.status === "created" || ctrlNode?.status === "returned") {
    // Happy path: apply PRESET_CENTER
    const layoutResult = (await bridge.call(
      "control.set_layout",
      { node_path: ctrlPath, preset: "PRESET_CENTER" },
      CALL_TIMEOUT,
    )) as { success?: boolean; preset?: string; final_rect?: Record<string, number> };

    if (layoutResult?.success !== true || layoutResult.preset !== "PRESET_CENTER")
      fail(`control.set_layout PRESET_CENTER: ${JSON.stringify(layoutResult)}`);
    else if (!layoutResult.final_rect) fail(`control.set_layout missing final_rect: ${JSON.stringify(layoutResult)}`);
    else pass(`control.set_layout PRESET_CENTER -> final_rect present`);

    // With margins
    const marginResult = (await bridge.call(
      "control.set_layout",
      {
        node_path: ctrlPath,
        preset: "PRESET_FULL_RECT",
        margins: { left: 10, top: 20 },
      },
      CALL_TIMEOUT,
    )) as { success?: boolean; preset_applied?: string };

    if (marginResult?.success !== true) fail(`control.set_layout with margins: ${JSON.stringify(marginResult)}`);
    else pass(`control.set_layout PRESET_FULL_RECT + margins`);

    // Guard: invalid preset
    assertGuard(
      ctx,
      "control.set_layout invalid preset",
      await bridge.call("control.set_layout", { node_path: ctrlPath, preset: "NOT_A_PRESET" }, CALL_TIMEOUT),
      "INVALID_PARAMS",
      "preset",
    );

    // Guard: non-Control node
    assertGuard(
      ctx,
      "control.set_layout on non-Control",
      await bridge.call("control.set_layout", { node_path: ".", preset: "PRESET_CENTER" }, CALL_TIMEOUT),
      "INVALID_CLASS",
      "Control",
    );

    await bridge.call("scene.delete_node", { node_path: ctrlPath }, CALL_TIMEOUT);
  } else {
    fail(`control.set_layout: could not create Control: ${JSON.stringify(ctrlNode)}`);
  }
}
