import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, unwrapUntrusted } from "../helpers.js";

export async function testSceneNodeBasics(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  const raw = await bridge.call("scene.get_tree", null, CALL_TIMEOUT) as { tree?: string; name?: string; children?: unknown[]; code?: string };
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

  // Idempotent create (iter 15 status discriminator).
  const nodeName = "SmokeProbe";
  const freshNode = await bridge.call("scene.create_node", { class_name: "Node", parent_path: ".", node_name: nodeName }, CALL_TIMEOUT) as { path?: string; status?: string; code?: string; error?: string };
  if (!freshNode || typeof freshNode.path !== "string") fail(`scene.create_node first call: ${JSON.stringify(freshNode)}`);
  else if (freshNode.status !== "created") fail(`scene.create_node fresh: expected status='created', got ${JSON.stringify(freshNode)}`);
  else pass(`scene.create_node fresh -> status='created' at ${freshNode.path}`);

  const idempotentNode = await bridge.call("scene.create_node", { class_name: "Node", parent_path: ".", node_name: nodeName }, CALL_TIMEOUT) as { path?: string; status?: string; code?: string };
  if (!idempotentNode || idempotentNode.status !== "returned" || idempotentNode.path !== freshNode.path) fail(`scene.create_node idempotency: expected status='returned' at ${freshNode.path}, got ${JSON.stringify(idempotentNode)}`);
  else if (idempotentNode.code !== undefined) fail(`scene.create_node collision success must not carry code (got ${idempotentNode.code})`);
  else pass(`scene.create_node idempotent -> status='returned' at ${idempotentNode.path}`);

  // Property round-trip via editor_description (plain String).
  const nodePath = freshNode?.path ?? nodeName;
  const marker = `smoke-${Date.now()}`;
  const setResult = await bridge.call("node.set_property", { node_path: nodePath, property: "editor_description", value: marker }, CALL_TIMEOUT) as { ok?: boolean; code?: string; error?: string };
  if (!setResult?.ok) fail(`node.set_property: ${JSON.stringify(setResult)}`);
  const getResult = await bridge.call("node.get_property", { node_path: nodePath, property: "editor_description" }, CALL_TIMEOUT) as { value?: unknown; code?: string };
  if (getResult?.value !== marker) fail(`node.get_property: expected ${marker} got ${JSON.stringify(getResult)}`);
  else pass("node.set_property + node.get_property round-trip");

  // Cleanup.
  const deleteResult = await bridge.call("scene.delete_node", { node_path: nodePath }, CALL_TIMEOUT) as { ok?: boolean; code?: string };
  if (!deleteResult?.ok) fail(`scene.delete_node: ${JSON.stringify(deleteResult)}`);
  else pass("scene.delete_node cleanup");
}
