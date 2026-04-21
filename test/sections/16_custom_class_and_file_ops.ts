import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, SCREENSHOT_TIMEOUT, assertGuard } from "../helpers.js";

export async function testCustomClassAndFileOps(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  // ── scene.create_node global class resolution ──
  const customClassScript = `class_name SmokeCustomNode\nextends Node2D\n\n@export var smoke_speed: float = 10.0\n`;
  await bridge.call(
    "script.write",
    { file_path: "res://smoke_custom_class.gd", content: customClassScript },
    CALL_TIMEOUT,
  );
  await bridge.call("editor.reload_scripts", {}, CALL_TIMEOUT);
  await bridge.call("editor.wait_for_idle", { timeout_ms: 5000 }, SCREENSHOT_TIMEOUT);

  const customNode = (await bridge.call(
    "scene.create_node",
    { class_name: "SmokeCustomNode", parent_path: "", node_name: "SmokeCustom" },
    CALL_TIMEOUT,
  )) as { success?: boolean; status?: string };
  if (!customNode?.success || customNode.status !== "created")
    fail(`scene.create_node with global class: ${JSON.stringify(customNode)}`);
  else pass("scene.create_node with global class_name -> created");

  const customIdempotent = (await bridge.call(
    "scene.create_node",
    { class_name: "SmokeCustomNode", parent_path: "", node_name: "SmokeCustom" },
    CALL_TIMEOUT,
  )) as { success?: boolean; status?: string };
  if (!customIdempotent?.success || customIdempotent.status !== "returned")
    fail(`scene.create_node global class idempotency: ${JSON.stringify(customIdempotent)}`);
  else pass("scene.create_node with global class_name -> idempotent returned");
  await bridge.call("scene.delete_node", { node_path: "SmokeCustom" }, CALL_TIMEOUT);

  // ── node.set_script round-trip ──
  await bridge.call(
    "scene.create_node",
    { class_name: "Node2D", parent_path: "", node_name: "ScriptTarget" },
    CALL_TIMEOUT,
  );
  const attachResult = (await bridge.call(
    "node.set_script",
    { node_path: "ScriptTarget", script_path: "res://smoke_custom_class.gd" },
    CALL_TIMEOUT,
  )) as { success?: boolean; properties?: { name: string }[] };
  if (!attachResult?.success) fail(`node.set_script attach: ${JSON.stringify(attachResult)}`);
  else pass("node.set_script attach -> success");
  if (
    !Array.isArray(attachResult?.properties) ||
    !attachResult.properties.some((p: { name: string }) => p.name === "smoke_speed")
  )
    fail(`node.set_script should return @export properties, got: ${JSON.stringify(attachResult?.properties)}`);
  else pass("node.set_script returns @export properties (smoke_speed found)");

  const detachResult = (await bridge.call(
    "node.set_script",
    { node_path: "ScriptTarget", script_path: "" },
    CALL_TIMEOUT,
  )) as { success?: boolean; script?: string | null; properties?: unknown[] };
  if (!detachResult?.success || detachResult.script !== null)
    fail(`node.set_script detach: ${JSON.stringify(detachResult)}`);
  else pass("node.set_script detach -> success, script: null");
  if (!Array.isArray(detachResult?.properties) || detachResult.properties.length !== 0)
    fail(`node.set_script detach should return empty properties, got: ${JSON.stringify(detachResult?.properties)}`);
  else pass("node.set_script detach -> properties empty");
  await bridge.call("scene.delete_node", { node_path: "ScriptTarget" }, CALL_TIMEOUT);
  await bridge.call("script.delete", { file_path: "res://smoke_custom_class.gd" }, CALL_TIMEOUT);

  // node.set_script guard rejections.
  assertGuard(
    ctx,
    "node.set_script no res://",
    await bridge.call("node.set_script", { node_path: ".", script_path: "/tmp/foo.gd" }, CALL_TIMEOUT),
    "PATH_DENIED",
    "absolute",
  );
  assertGuard(
    ctx,
    "node.set_script not found",
    await bridge.call("node.set_script", { node_path: ".", script_path: "res://nonexistent_script.gd" }, CALL_TIMEOUT),
    "LOAD_FAILED",
    "cannot load",
  );

  // ── file.delete round-trip ──
  const MINI_PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQABNjN9GQAAAABJRU5ErkJggg==";
  const fileDelPath = "res://smoke_15i_file_del.png";
  await bridge.call(
    "asset.import",
    { base64_data: MINI_PNG_B64, dest_path: fileDelPath, if_exists: "replace" },
    SCREENSHOT_TIMEOUT,
  );
  const fileDelResult = (await bridge.call("file.delete", { file_path: fileDelPath }, CALL_TIMEOUT)) as {
    success?: boolean;
    code?: string;
  };
  if (!fileDelResult?.success) fail(`file.delete: ${JSON.stringify(fileDelResult)}`);
  else pass("file.delete -> success");
  assertGuard(
    ctx,
    "file.delete re-delete",
    await bridge.call("file.delete", { file_path: fileDelPath }, CALL_TIMEOUT),
    "NOT_FOUND",
    "not found",
  );
  assertGuard(
    ctx,
    "file.delete no res://",
    await bridge.call("file.delete", { file_path: "/tmp/foo.png" }, CALL_TIMEOUT),
    "PATH_DENIED",
    "absolute",
  );
  assertGuard(
    ctx,
    "file.delete nonexistent",
    await bridge.call("file.delete", { file_path: "res://no_such_file_15i.png" }, CALL_TIMEOUT),
    "NOT_FOUND",
    "not found",
  );
  assertGuard(
    ctx,
    "file.delete plugin self-protect",
    await bridge.call("file.delete", { file_path: "res://addons/godot_mcp_toolkit/plugin.cfg" }, CALL_TIMEOUT),
    "PATH_DENIED",
    "toolkit",
  );
}
