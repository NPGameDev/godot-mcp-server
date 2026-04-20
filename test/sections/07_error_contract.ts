import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, assertError } from "../helpers.js";

export async function testErrorContract(ctx: TestCtx): Promise<void> {
  const { bridge, pass } = ctx;

  assertError(ctx, "scene.create_node bogus class",
    await bridge.call("scene.create_node", { class_name: "NotAClass", parent_path: "." }, CALL_TIMEOUT), "INVALID_CLASS");
  assertError(ctx, "scene.delete_node bogus path",
    await bridge.call("scene.delete_node", { node_path: "NoSuchNode_xyz" }, CALL_TIMEOUT), "NOT_FOUND");
  assertError(ctx, "scene.delete_node refuses root",
    await bridge.call("scene.delete_node", { node_path: "." }, CALL_TIMEOUT), "INVALID_PATH");
  assertError(ctx, "node.get_property bogus path",
    await bridge.call("node.get_property", { node_path: "NoSuchNode_xyz", property: "name" }, CALL_TIMEOUT), "NOT_FOUND");
  assertError(ctx, "node.set_property bogus path",
    await bridge.call("node.set_property", { node_path: "NoSuchNode_xyz", property: "editor_description", value: "x" }, CALL_TIMEOUT), "NOT_FOUND");
  assertError(ctx, "node.get_property_list bogus path",
    await bridge.call("node.get_property_list", { node_path: "NoSuchNode_xyz" }, CALL_TIMEOUT), "NOT_FOUND");
  assertError(ctx, "script.write user:// path",
    await bridge.call("script.write", { file_path: "user://bad.txt", content: "x" }, CALL_TIMEOUT), "PATH_DENIED");
  assertError(ctx, "editor.save_scene non-res:// path",
    await bridge.call("editor.save_scene", { file_path: "/tmp/bad.tscn" }, CALL_TIMEOUT), "PATH_DENIED");
  assertError(ctx, "signal.list bogus path",
    await bridge.call("signal.list", { node_path: "NoSuchNode_xyz" }, CALL_TIMEOUT), "NOT_FOUND");
  assertError(ctx, "signal.manage connect bogus signal",
    await bridge.call("signal.manage", { action: "connect", source_path: ".", signal_name: "no_such_signal_xyz", target_path: ".", method_name: "notify_property_list_changed" }, CALL_TIMEOUT), "INVALID_PARAMS");
  assertError(ctx, "signal.emit bogus signal",
    await bridge.call("signal.emit", { node_path: ".", signal_name: "no_such_signal_xyz" }, CALL_TIMEOUT), "INVALID_PARAMS");
  assertError(ctx, "scene.diff missing before",
    await bridge.call("scene.diff", {}, CALL_TIMEOUT), "INVALID_PARAMS");
  assertError(ctx, "resource.load non-res://",
    await bridge.call("resource.load", { file_path: "/etc/passwd" }, CALL_TIMEOUT), "PATH_DENIED");

  // Iter 15 status discriminator regression guard.
  const idemNodeName = "IdempotencyProbe";
  const idemFirst = await bridge.call("scene.create_node", { class_name: "Node", parent_path: ".", node_name: idemNodeName }, CALL_TIMEOUT) as { path?: string; status?: string; success?: boolean };
  const idemSecond = await bridge.call("scene.create_node", { class_name: "Node", parent_path: ".", node_name: idemNodeName }, CALL_TIMEOUT) as { path?: string; status?: string; code?: string; success?: boolean };
  if (idemSecond?.success === false) {
    ctx.fail(`idempotent repeat must NOT carry success:false: ${JSON.stringify(idemSecond)}`);
  } else if (idemSecond?.status !== "returned") {
    ctx.fail(`idempotent repeat must carry status='returned': ${JSON.stringify(idemSecond)}`);
  } else if (idemSecond?.code !== undefined) {
    ctx.fail(`idempotent success must NOT carry code (got ${idemSecond.code})`);
  } else if (idemSecond?.path !== idemFirst?.path) {
    ctx.fail(`idempotent repeat must return same path: ${JSON.stringify({ first: idemFirst, second: idemSecond })}`);
  } else {
    pass("idempotent repeat -> non-error success, status='returned', code absent (iter 15 I3)");
  }
  await bridge.call("scene.delete_node", { node_path: idemFirst?.path ?? idemNodeName }, CALL_TIMEOUT);
}
