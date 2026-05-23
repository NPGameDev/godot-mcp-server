import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, assertGuard } from "../helpers.js";

export const TOOLS_TESTED: string[] = ["tilemap_read_cells", "control_set_layout", "scene_create_node"];

export async function testNewTools(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  // ── tilemap.read_cells guards ──
  assertGuard(
    ctx,
    "tilemap.read_cells non-tilemap node",
    await bridge.call("tilemap.read_cells", { node_path: "." }, CALL_TIMEOUT),
    "INVALID_NODE",
    "TileMap",
  );

  assertGuard(
    ctx,
    "tilemap.read_cells missing node",
    await bridge.call("tilemap.read_cells", { node_path: "NoSuchNode99" }, CALL_TIMEOUT),
    "NOT_FOUND",
  );

  // ── tilemap.read_cells on empty TileMapLayer ──
  const tmlNode = (await bridge.call(
    "scene.create_node",
    { class_name: "TileMapLayer", parent_path: ".", node_name: "MCPSmokeReadTML" },
    CALL_TIMEOUT,
  )) as { status?: string; path?: string };
  const tmlPath = tmlNode?.path ?? "MCPSmokeReadTML";

  if (tmlNode?.status === "created" || tmlNode?.status === "returned") {
    const readEmpty = (await bridge.call("tilemap.read_cells", { node_path: tmlPath }, CALL_TIMEOUT)) as {
      success?: boolean;
      cell_count?: number;
      cells_total?: number;
      bounds?: Record<string, number>;
    };
    if (readEmpty?.success !== true || readEmpty.cell_count !== 0)
      fail(`tilemap.read_cells empty: ${JSON.stringify(readEmpty)}`);
    else pass(`tilemap.read_cells empty TileMapLayer -> cell_count=0`);

    await bridge.call("scene.delete_node", { node_path: tmlPath }, CALL_TIMEOUT);
  } else {
    fail(`tilemap.read_cells: could not create TileMapLayer: ${JSON.stringify(tmlNode)}`);
  }

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
    )) as { success?: boolean; preset_applied?: string; final_rect?: Record<string, number> };

    if (layoutResult?.success !== true || layoutResult.preset_applied !== "PRESET_CENTER")
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
      "INVALID_INPUT",
    );

    // Guard: non-Control node
    assertGuard(
      ctx,
      "control.set_layout on non-Control",
      await bridge.call("control.set_layout", { node_path: ".", preset: "PRESET_CENTER" }, CALL_TIMEOUT),
      "INVALID_NODE",
    );

    await bridge.call("scene.delete_node", { node_path: ctrlPath }, CALL_TIMEOUT);
  } else {
    fail(`control.set_layout: could not create Control: ${JSON.stringify(ctrlNode)}`);
  }

  // ── scene.create_node with inline properties ──
  const propNode = (await bridge.call(
    "scene.create_node",
    {
      class_name: "Sprite2D",
      parent_path: ".",
      node_name: "MCPSmokePropNode",
      properties: { visible: false, modulate: "Color(1, 0, 0, 1)" },
    },
    CALL_TIMEOUT,
  )) as {
    status?: string;
    path?: string;
    properties_set?: number;
    properties_failed?: Array<{ name: string; error: string }>;
  };
  const propPath = propNode?.path ?? "MCPSmokePropNode";

  if (propNode?.status === "created" || propNode?.status === "returned") {
    if (propNode.properties_set == null || propNode.properties_set < 1)
      fail(`scene.create_node properties: properties_set=${propNode.properties_set}`);
    else pass(`scene.create_node inline properties -> properties_set=${propNode.properties_set}`);

    // Verify the property was actually applied
    const getProp = (await bridge.call(
      "node.get_property",
      { node_path: propPath, property: "visible" },
      CALL_TIMEOUT,
    )) as { success?: boolean; value?: unknown };
    if (getProp?.value !== false) fail(`inline property visible not applied: ${JSON.stringify(getProp)}`);
    else pass(`inline property visible=false verified via node.get_property`);

    await bridge.call("scene.delete_node", { node_path: propPath }, CALL_TIMEOUT);
  } else {
    fail(`scene.create_node with properties: ${JSON.stringify(propNode)}`);
  }

  // scene.create_node with bad property — node should still be created
  const badPropNode = (await bridge.call(
    "scene.create_node",
    {
      class_name: "Node2D",
      parent_path: ".",
      node_name: "MCPSmokeBadProp",
      properties: { nonexistent_property_xyz: 42 },
    },
    CALL_TIMEOUT,
  )) as {
    status?: string;
    path?: string;
    properties_failed?: Array<{ name: string; error: string }>;
  };

  if (badPropNode?.status === "created" || badPropNode?.status === "returned") {
    if (!badPropNode.properties_failed || badPropNode.properties_failed.length === 0)
      fail(`scene.create_node bad prop: expected properties_failed: ${JSON.stringify(badPropNode)}`);
    else pass(`scene.create_node bad prop -> node created, properties_failed reported`);

    await bridge.call("scene.delete_node", { node_path: badPropNode.path ?? "MCPSmokeBadProp" }, CALL_TIMEOUT);
  } else {
    fail(`scene.create_node with bad property should still create node: ${JSON.stringify(badPropNode)}`);
  }
}
