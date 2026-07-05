import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, assertError, assertHint } from "../helpers.js";

export const TOOLS_TESTED: string[] = [
  "scene_create_node",
  "scene_delete_node",
  "node_get_property",
  "node_set_property",
  "node_get_property_list",
  "script_write",
  "script_read",
  "editor_save_scene",
  "signal_list",
  "signal_manage",
  "signal_emit",
  "scene_diff",
  "resource_load",
];
export async function testErrorContract(ctx: TestCtx): Promise<void> {
  const { bridge, pass } = ctx;

  assertError(
    ctx,
    "scene.create_node bogus class",
    await bridge.call("scene.create_node", { class_name: "NotAClass", parent_path: "." }, CALL_TIMEOUT),
    "INVALID_CLASS",
  );
  assertError(
    ctx,
    "scene.delete_node bogus path",
    await bridge.call("scene.delete_node", { node_path: "NoSuchNode_xyz" }, CALL_TIMEOUT),
    "NOT_FOUND",
  );
  assertError(
    ctx,
    "scene.delete_node refuses root",
    await bridge.call("scene.delete_node", { node_path: "." }, CALL_TIMEOUT),
    "INVALID_PATH",
  );
  assertError(
    ctx,
    "node.get_property bogus path",
    await bridge.call("node.get_property", { node_path: "NoSuchNode_xyz", property: "name" }, CALL_TIMEOUT),
    "NOT_FOUND",
  );
  assertError(
    ctx,
    "node.set_property bogus path",
    await bridge.call(
      "node.set_property",
      { node_path: "NoSuchNode_xyz", property: "editor_description", value: "x" },
      CALL_TIMEOUT,
    ),
    "NOT_FOUND",
  );
  assertError(
    ctx,
    "node.get_property_list bogus path",
    await bridge.call("node.get_property_list", { node_path: "NoSuchNode_xyz" }, CALL_TIMEOUT),
    "NOT_FOUND",
  );
  assertError(
    ctx,
    "script.write user:// path",
    await bridge.call("script.write", { file_path: "user://bad.txt", content: "x" }, CALL_TIMEOUT),
    "PATH_DENIED",
  );
  assertError(
    ctx,
    "editor.save_scene non-res:// path",
    await bridge.call("editor.save_scene", { file_path: "/tmp/bad.tscn" }, CALL_TIMEOUT),
    "PATH_DENIED",
  );
  assertError(
    ctx,
    "signal.list bogus path",
    await bridge.call("signal.list", { node_path: "NoSuchNode_xyz" }, CALL_TIMEOUT),
    "NOT_FOUND",
  );
  assertError(
    ctx,
    "signal.manage connect bogus signal",
    await bridge.call(
      "signal.manage",
      {
        action: "connect",
        source_path: ".",
        signal_name: "no_such_signal_xyz",
        target_path: ".",
        method_name: "notify_property_list_changed",
      },
      CALL_TIMEOUT,
    ),
    "INVALID_PARAMS",
  );
  assertError(
    ctx,
    "signal.emit bogus signal",
    await bridge.call("signal.emit", { node_path: ".", signal_name: "no_such_signal_xyz" }, CALL_TIMEOUT),
    "INVALID_PARAMS",
  );
  assertError(ctx, "scene.diff missing before", await bridge.call("scene.diff", {}, CALL_TIMEOUT), "INVALID_PARAMS");
  assertError(
    ctx,
    "resource.load non-res://",
    await bridge.call("resource.load", { file_path: "/etc/passwd" }, CALL_TIMEOUT),
    "PATH_DENIED",
  );

  // Status discriminator regression guard.
  const idemNodeName = "IdempotencyProbe";
  const idemFirst = (await bridge.call(
    "scene.create_node",
    { class_name: "Node", parent_path: ".", node_name: idemNodeName },
    CALL_TIMEOUT,
  )) as { path?: string; status?: string; success?: boolean };
  const idemSecond = (await bridge.call(
    "scene.create_node",
    { class_name: "Node", parent_path: ".", node_name: idemNodeName },
    CALL_TIMEOUT,
  )) as { path?: string; status?: string; code?: string; success?: boolean };
  if (idemSecond?.success === false) {
    ctx.fail(`idempotent repeat must NOT carry success:false: ${JSON.stringify(idemSecond)}`);
  } else if (idemSecond?.status !== "returned") {
    ctx.fail(`idempotent repeat must carry status='returned': ${JSON.stringify(idemSecond)}`);
  } else if (idemSecond?.code !== undefined) {
    ctx.fail(`idempotent success must NOT carry code (got ${idemSecond.code})`);
  } else if (idemSecond?.path !== idemFirst?.path) {
    ctx.fail(`idempotent repeat must return same path: ${JSON.stringify({ first: idemFirst, second: idemSecond })}`);
  } else {
    pass("idempotent repeat -> non-error success, status='returned', code absent");
  }
  await bridge.call("scene.delete_node", { node_path: idemFirst?.path ?? idemNodeName }, CALL_TIMEOUT);

  // ── Recovery hint assertions ─────────────────────────────────────────────
  const hintNode = (await bridge.call("scene.delete_node", { node_path: "NoSuchHint_xyz" }, CALL_TIMEOUT)) as {
    code?: string;
    hint?: string;
  };
  if (hintNode?.code === "NOT_FOUND") {
    assertHint(ctx, "hint: node NOT_FOUND", hintNode, "scene.get_tree");
  } else {
    ctx.fail(`hint: node NOT_FOUND: unexpected code ${hintNode?.code}`);
  }

  const hintFile = (await bridge.call(
    "script.read",
    { file_path: "res://no_such_file_hint_xyz.gd" },
    CALL_TIMEOUT,
  )) as { code?: string; hint?: string };
  if (hintFile?.code === "NOT_FOUND") {
    assertHint(ctx, "hint: file NOT_FOUND", hintFile, "asset.list");
  } else {
    ctx.fail(`hint: file NOT_FOUND: unexpected code ${hintFile?.code}`);
  }

  const hintDenied = (await bridge.call(
    "script.write",
    { file_path: "user://bad_hint.txt", content: "x" },
    CALL_TIMEOUT,
  )) as { code?: string; hint?: string };
  if (hintDenied?.code === "PATH_DENIED") {
    assertHint(ctx, "hint: PATH_DENIED default", hintDenied, "res://");
  } else {
    ctx.fail(`hint: PATH_DENIED: unexpected code ${hintDenied?.code}`);
  }

  const hintClass = (await bridge.call(
    "scene.create_node",
    { class_name: "NotAClassHint_xyz", parent_path: "." },
    CALL_TIMEOUT,
  )) as { code?: string; hint?: string };
  if (hintClass?.code === "INVALID_CLASS") {
    assertHint(ctx, "hint: INVALID_CLASS", hintClass, "classdb");
  } else {
    ctx.fail(`hint: INVALID_CLASS: unexpected code ${hintClass?.code}`);
  }
}
