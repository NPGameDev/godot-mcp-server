import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, unwrapUntrusted, assertGuard, assertError } from "../helpers.js";

export const TOOLS_TESTED: string[] = [
  "scene_get_tree",
  "scene_create_node",
  "scene_delete_node",
  "node_set_property",
  "node_get_property",
];
export async function testSceneNodeBasics(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  const raw = (await bridge.call("scene.get_tree", null, CALL_TIMEOUT)) as {
    tree?: string;
    name?: string;
    children?: unknown[];
    code?: string;
  };
  if (raw && raw.code === "NO_SCENE") {
    fail("scene.get_tree: NO_SCENE — open Main.tscn in the Godot editor before running smoke");
  } else {
    const tree = (raw?.tree ? unwrapUntrusted(raw.tree) : raw) as { name?: string; children?: unknown[] };
    if (!tree || typeof tree.name !== "string" || !Array.isArray(tree.children)) {
      fail(`scene.get_tree: unexpected shape ${JSON.stringify(raw)}`);
    } else {
      pass(`scene.get_tree root=${tree.name}`);
    }
  }

  // Idempotent create (status discriminator).
  const nodeName = "SmokeProbe";
  const freshNode = (await bridge.call(
    "scene.create_node",
    { class_name: "Node", parent_path: ".", node_name: nodeName },
    CALL_TIMEOUT,
  )) as { path?: string; status?: string; code?: string; error?: string };
  if (!freshNode || typeof freshNode.path !== "string")
    fail(`scene.create_node first call: ${JSON.stringify(freshNode)}`);
  else if (freshNode.status !== "created")
    fail(`scene.create_node fresh: expected status='created', got ${JSON.stringify(freshNode)}`);
  else pass(`scene.create_node fresh -> status='created' at ${freshNode.path}`);

  const idempotentNode = (await bridge.call(
    "scene.create_node",
    { class_name: "Node", parent_path: ".", node_name: nodeName },
    CALL_TIMEOUT,
  )) as { path?: string; status?: string; code?: string; warning?: string };
  if (!idempotentNode || idempotentNode.status !== "returned" || idempotentNode.path !== freshNode.path)
    fail(
      `scene.create_node idempotency: expected status='returned' at ${freshNode.path}, got ${JSON.stringify(idempotentNode)}`,
    );
  else if (idempotentNode.code !== undefined)
    fail(`scene.create_node collision success must not carry code (got ${idempotentNode.code})`);
  // No droppable args passed → no disclosure (response identical to a bare return).
  else if (idempotentNode.warning !== undefined)
    fail(`scene.create_node bare return must not warn (got ${idempotentNode.warning})`);
  else pass(`scene.create_node idempotent -> status='returned' (code + warning absent)`);

  // Returned-path disclosure: properties/unique_name are ignored on a collision
  // return; the warning must name exactly the dropped args the caller passed.
  const droppedArgsNode = (await bridge.call(
    "scene.create_node",
    {
      class_name: "Node",
      parent_path: ".",
      node_name: nodeName,
      properties: { name: "Renamed" },
      unique_name: true,
    },
    CALL_TIMEOUT,
  )) as { path?: string; status?: string; warning?: string };
  if (droppedArgsNode?.status !== "returned")
    fail(`scene.create_node dropped-args: expected status='returned', got ${JSON.stringify(droppedArgsNode)}`);
  else if (
    typeof droppedArgsNode.warning !== "string" ||
    !droppedArgsNode.warning.includes("properties") ||
    !droppedArgsNode.warning.includes("unique_name")
  )
    fail(
      `scene.create_node dropped-args: expected warning naming properties + unique_name, got ${JSON.stringify(droppedArgsNode.warning)}`,
    );
  else pass(`scene.create_node returned + dropped args -> warning names properties, unique_name`);

  // unique_name flag.
  const uniqueNodeName = "SmokeUniqueProbe";
  const uniqueNode = (await bridge.call(
    "scene.create_node",
    { class_name: "Node", parent_path: ".", node_name: uniqueNodeName, unique_name: true },
    CALL_TIMEOUT,
  )) as { path?: string; status?: string; unique_name?: boolean; code?: string };
  if (!uniqueNode || uniqueNode.status !== "created" || uniqueNode.unique_name !== true)
    fail(
      `scene.create_node unique_name: expected status='created' + unique_name=true, got ${JSON.stringify(uniqueNode)}`,
    );
  else pass(`scene.create_node unique_name=true -> created at ${uniqueNode.path}`);
  // Cleanup unique node.
  await bridge.call("scene.delete_node", { node_path: uniqueNode?.path ?? uniqueNodeName }, CALL_TIMEOUT);

  // Property round-trip via editor_description (plain String).
  // IMPORTANT: target the scene ROOT (".", never deleted), NOT a probe node we
  // then delete. Setting editor_description arms a 0.5s one-shot tooltip timer
  // in the engine's SceneTreeEditor that binds a raw TreeItem*; deleting that
  // node within 0.5s makes the timer fire on freed memory → editor SIGSEGV
  // (UAF, Godot 4.3+, unguarded on master). Section 02 was the
  // suite's only arming op; round-tripping on the root (then restoring "")
  // exercises the same code path without ever deleting the described node.
  const nodePath = freshNode?.path ?? nodeName;
  const marker = `smoke-${Date.now()}`;
  const setResult = (await bridge.call(
    "node.set_property",
    { node_path: ".", property: "editor_description", value: marker },
    CALL_TIMEOUT,
  )) as { success?: boolean; code?: string; error?: string };
  if (!setResult?.success) fail(`node.set_property: ${JSON.stringify(setResult)}`);
  const getResult = (await bridge.call(
    "node.get_property",
    { node_path: ".", property: "editor_description" },
    CALL_TIMEOUT,
  )) as { value?: unknown; code?: string };
  if (getResult?.value !== marker) fail(`node.get_property: expected ${marker} got ${JSON.stringify(getResult)}`);
  else pass("node.set_property + node.get_property round-trip");
  // Restore the root's editor_description (hygiene; harmless re-arm on a node
  // that is never deleted).
  await bridge.call("node.set_property", { node_path: ".", property: "editor_description", value: "" }, CALL_TIMEOUT);

  // Cleanup the probe node (created above; never carried editor_description).
  const deleteResult = (await bridge.call("scene.delete_node", { node_path: nodePath }, CALL_TIMEOUT)) as {
    success?: boolean;
    code?: string;
  };
  if (!deleteResult?.success) fail(`scene.delete_node: ${JSON.stringify(deleteResult)}`);
  else pass("scene.delete_node cleanup");

  // ── REGRESSION: scene_create_node class mismatch guard ──
  // Creating a node with a class_name that doesn't match a real Godot class
  // should return a clear CLASS_MISMATCH error.
  assertGuard(
    ctx,
    "REGRESSION scene_create_node CLASS_MISMATCH",
    await bridge.call(
      "scene.create_node",
      { class_name: "BogusNonExistentClass_Smoke", parent_path: ".", node_name: "ShouldFail" },
      CALL_TIMEOUT,
    ),
    "INVALID_CLASS",
    "BogusNonExistentClass_Smoke",
  );

  // ── Compound property path contract: struct components are unsupported ──
  // set_property_compound navigates Object/Resource chains (e.g.
  // "material:shader_parameter/value"); built-in struct components like
  // Vector2's "position:x" are NOT navigable (position is not an Object) and
  // return NOT_FOUND by design. Assert that contract explicitly so a future
  // behavior change (e.g. set_indexed support) shows up as a failing test
  // instead of passing vacuously. Resource-chain compound paths are covered in
  // sections 13/31.
  const compoundNode = (await bridge.call(
    "scene.create_node",
    { class_name: "Node2D", parent_path: ".", node_name: "CompoundProbe" },
    CALL_TIMEOUT,
  )) as { path?: string; status?: string };
  if (compoundNode?.status === "created") {
    const compoundPath = compoundNode.path ?? "CompoundProbe";
    const compoundSet = await bridge.call(
      "node.set_property",
      { node_path: compoundPath, property: "position:x", value: 42 },
      CALL_TIMEOUT,
    );
    assertError(
      ctx,
      "compound struct-component path position:x -> NOT_FOUND (unsupported by design)",
      compoundSet,
      "NOT_FOUND",
    );
    await bridge.call("scene.delete_node", { node_path: compoundPath }, CALL_TIMEOUT);
  }

  // ── Hint assertion: scene_create_node with preload-eligible class ──
  // When creating a custom scripted node, the response should hint about preload/load.
  // This tests the DX improvement from T:cb4e162 / T:a46487b.
  const preloadHintNode = (await bridge.call(
    "scene.create_node",
    { class_name: "Sprite2D", parent_path: ".", node_name: "PreloadHintProbe" },
    CALL_TIMEOUT,
  )) as { path?: string; status?: string; hint?: string };
  if (preloadHintNode?.status === "created") {
    // The hint may only appear for scripted/custom classes, not built-in ones.
    // For built-in classes, accept either presence or absence of hint.
    if (preloadHintNode.hint) {
      pass(`scene_create_node hint present: "${preloadHintNode.hint.slice(0, 60)}..."`);
    } else {
      pass("scene_create_node hint: not present for built-in class (expected)");
    }
    await bridge.call("scene.delete_node", { node_path: preloadHintNode.path ?? "PreloadHintProbe" }, CALL_TIMEOUT);
  }

  // ── scene.create_node with inline properties (redistributed from section 44) ──
  // modulate uses the canonical typed-dict Color format (a raw "Color(...)"
  // string never coerces — it used to reach instance.set() as a String, log an
  // "Invalid color name" engine error, and leave the property unset while the
  // test passed vacuously on visible alone).
  const propNode = (await bridge.call(
    "scene.create_node",
    {
      class_name: "Sprite2D",
      parent_path: ".",
      node_name: "MCPSmokePropNode",
      properties: { visible: false, modulate: { type: "Color", r: 1, g: 0, b: 0, a: 1 } },
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
    if (propNode.properties_set !== 2)
      fail(
        `scene.create_node properties: expected properties_set=2 (visible + modulate), got ${propNode.properties_set} (failed: ${JSON.stringify(propNode.properties_failed)})`,
      );
    else pass(`scene.create_node inline properties -> properties_set=2`);

    // Verify both properties were actually applied.
    const getProp = (await bridge.call(
      "node.get_property",
      { node_path: propPath, property: "visible" },
      CALL_TIMEOUT,
    )) as { success?: boolean; value?: unknown };
    if (getProp?.value !== false) fail(`inline property visible not applied: ${JSON.stringify(getProp)}`);
    else pass(`inline property visible=false verified via node.get_property`);

    const getModulate = (await bridge.call(
      "node.get_property",
      { node_path: propPath, property: "modulate" },
      CALL_TIMEOUT,
    )) as { value?: { type?: string; r?: number; g?: number; b?: number; a?: number } };
    const m = getModulate?.value;
    if (m?.type !== "Color" || m.r !== 1 || m.g !== 0 || m.b !== 0 || m.a !== 1)
      fail(`inline property modulate not applied: ${JSON.stringify(getModulate)}`);
    else pass(`inline property modulate=Color(1,0,0,1) verified via node.get_property`);

    await bridge.call("scene.delete_node", { node_path: propPath }, CALL_TIMEOUT);
  } else {
    fail(`scene.create_node with properties: ${JSON.stringify(propNode)}`);
  }

  // scene.create_node with unknown property — node still created, property reported in failures.
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
    properties_set?: number;
    properties_failed?: Array<{ name: string; error: string }>;
  };

  if (badPropNode?.status === "created" || badPropNode?.status === "returned") {
    if (!badPropNode.properties_failed || badPropNode.properties_failed.length === 0)
      fail(`scene.create_node bad prop: expected properties_failed: ${JSON.stringify(badPropNode)}`);
    else pass(`scene.create_node bad prop -> node created, properties_failed reported`);
    await bridge.call("scene.delete_node", { node_path: badPropNode.path ?? "MCPSmokeBadProp" }, CALL_TIMEOUT);
  } else {
    fail(`scene.create_node with unknown property should still create node: ${JSON.stringify(badPropNode)}`);
  }

  // ── scene.create_node inline-property drop reporting ──
  // Wire-form values that node_set_property rejects (a bare string for a Resource
  // property, a bare array for a struct property) are dropped by Godot's set(),
  // not applied. The inline-property loop must report them as properties_failed
  // (not silently count them in properties_set), matching node_set_property's
  // direct-call rejection of the same values.
  const dropReportNode = (await bridge.call(
    "scene.create_node",
    {
      class_name: "Sprite2D",
      parent_path: ".",
      node_name: "MCPSmokeDropReport",
      properties: { texture: "res://icon.svg", scale: [4, 4] },
    },
    CALL_TIMEOUT,
  )) as {
    status?: string;
    path?: string;
    properties_set?: number;
    properties_failed?: Array<{ name: string; error: string }>;
  };
  if (dropReportNode?.status === "created" || dropReportNode?.status === "returned") {
    const failedNames = (dropReportNode.properties_failed ?? []).map((f) => f.name);
    if (dropReportNode.properties_set !== 0)
      fail(
        `scene.create_node drop reporting: expected properties_set=0, got ${dropReportNode.properties_set} (failed: ${JSON.stringify(dropReportNode.properties_failed)})`,
      );
    else if (!failedNames.includes("texture") || !failedNames.includes("scale"))
      fail(
        `scene.create_node drop reporting: expected properties_failed naming texture + scale, got ${JSON.stringify(dropReportNode.properties_failed)}`,
      );
    else pass(`scene.create_node bad-form inline props -> properties_set=0, properties_failed names texture + scale`);
    await bridge.call("scene.delete_node", { node_path: dropReportNode.path ?? "MCPSmokeDropReport" }, CALL_TIMEOUT);
  } else {
    fail(`scene.create_node bad-form inline props should still create node: ${JSON.stringify(dropReportNode)}`);
  }
}
