import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, assertGuard } from "../helpers.js";

export async function testSceneFileLifecycle(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  const scenePath = "res://smoke_throwaway.tscn";
  try { await bridge.call("scene.delete", { file_path: scenePath }, CALL_TIMEOUT); } catch { /* orphan cleanup */ }

  // Fresh create.
  const sceneCreated = await bridge.call("scene.create", { file_path: scenePath, root_type: "Node2D" }, CALL_TIMEOUT) as { success?: boolean; status?: string; path?: string; root_type?: string; code?: string };
  if (sceneCreated?.status !== "created" || sceneCreated.path !== scenePath || sceneCreated.root_type !== "Node2D") {
    fail(`scene.create fresh: expected status='created' path=${scenePath} root_type='Node2D', got ${JSON.stringify(sceneCreated)}`);
  } else pass(`scene.create fresh -> status='created' root_type=Node2D`);

  // Default if_exists (return).
  const sceneReturned = await bridge.call("scene.create", { file_path: scenePath, root_type: "Node2D" }, CALL_TIMEOUT) as { success?: boolean; status?: string; path?: string; code?: string };
  if (sceneReturned?.status !== "returned" || sceneReturned.path !== scenePath) {
    fail(`scene.create default if_exists repeat: expected status='returned', got ${JSON.stringify(sceneReturned)}`);
  } else if (sceneReturned.code !== undefined) fail(`scene.create returned must not carry code (got ${sceneReturned.code})`);
  else pass(`scene.create default repeat -> status='returned' (code absent)`);

  // if_exists: fail.
  const sceneFailed = await bridge.call("scene.create", { file_path: scenePath, root_type: "Node2D", if_exists: "fail" }, CALL_TIMEOUT) as { success?: boolean; code?: string; error?: string };
  if (sceneFailed?.success !== false || sceneFailed.code !== "ALREADY_EXISTS" || !sceneFailed.error?.includes("replace")) {
    fail(`scene.create if_exists=fail: expected ALREADY_EXISTS mentioning 'replace', got ${JSON.stringify(sceneFailed)}`);
  } else pass(`scene.create if_exists='fail' -> ALREADY_EXISTS (message steers to 'replace')`);

  // if_exists: replace.
  const sceneReplaced = await bridge.call("scene.create", { file_path: scenePath, root_type: "Node3D", if_exists: "replace" }, CALL_TIMEOUT) as { success?: boolean; status?: string; path?: string; root_type?: string; previous_root_type?: string; code?: string };
  if (sceneReplaced?.status !== "replaced" || sceneReplaced.root_type !== "Node3D" || sceneReplaced.previous_root_type !== "Node2D") {
    fail(`scene.create if_exists=replace: expected status='replaced' root_type=Node3D prev=Node2D, got ${JSON.stringify(sceneReplaced)}`);
  } else pass(`scene.create if_exists='replace' -> status='replaced' prev=${sceneReplaced.previous_root_type}`);

  // Invalid if_exists.
  const sceneBadIfExists = await bridge.call("scene.create", { file_path: scenePath, root_type: "Node", if_exists: "explode" }, CALL_TIMEOUT) as { success?: boolean; code?: string; error?: string };
  if (sceneBadIfExists?.code !== "INVALID_PARAMS" || !sceneBadIfExists.error?.includes("if_exists")) {
    fail(`scene.create invalid if_exists: expected INVALID_PARAMS, got ${JSON.stringify(sceneBadIfExists)}`);
  } else pass(`scene.create if_exists='explode' -> INVALID_PARAMS`);

  // Guard rejections.
  assertGuard(ctx, "scene.create /tmp path", await bridge.call("scene.create", { file_path: "/tmp/foo.tscn", root_type: "Node" }, CALL_TIMEOUT), "PATH_DENIED", "absolute");
  assertGuard(ctx, "scene.create .txt extension", await bridge.call("scene.create", { file_path: "res://foo.txt", root_type: "Node" }, CALL_TIMEOUT), "INVALID_PATH", ".tscn");
  assertGuard(ctx, "scene.create missing parent dir", await bridge.call("scene.create", { file_path: "res://nonexistent_smoke_dir/foo.tscn", root_type: "Node" }, CALL_TIMEOUT), "PARENT_NOT_FOUND", "folder.create");
  assertGuard(ctx, "scene.create bogus class", await bridge.call("scene.create", { file_path: "res://smoke_bogus.tscn", root_type: "BogusClass" }, CALL_TIMEOUT), "INVALID_CLASS", ["ClassDB", "ProjectSettings"]);
  assertGuard(ctx, "scene.create Resource (not a Node)", await bridge.call("scene.create", { file_path: "res://smoke_resource.tscn", root_type: "Resource" }, CALL_TIMEOUT), "INVALID_CLASS", "Node");

  // scene.delete round-trip.
  const sceneDeleted = await bridge.call("scene.delete", { file_path: scenePath }, CALL_TIMEOUT) as { success?: boolean; path?: string; code?: string };
  if (sceneDeleted?.success !== true || sceneDeleted.path !== scenePath) fail(`scene.delete: ${JSON.stringify(sceneDeleted)}`);
  else pass(`scene.delete ${scenePath}`);
  const sceneDeleteRepeat = await bridge.call("scene.delete", { file_path: scenePath }, CALL_TIMEOUT) as { success?: boolean; code?: string };
  if (sceneDeleteRepeat?.success !== false || sceneDeleteRepeat.code !== "NOT_FOUND") fail(`scene.delete repeat: expected NOT_FOUND, got ${JSON.stringify(sceneDeleteRepeat)}`);
  else pass(`scene.delete repeat -> NOT_FOUND`);
  assertGuard(ctx, "scene.delete .txt extension", await bridge.call("scene.delete", { file_path: "res://bogus.txt" }, CALL_TIMEOUT), "INVALID_PATH", ".tscn");

  // EDITED_SCENE refusal + clean teardown via scene.close.
  const editedProbePath = "res://smoke_edited_probe.tscn";
  await bridge.call("scene.create", { file_path: editedProbePath, root_type: "Node", if_exists: "return" }, CALL_TIMEOUT);
  await bridge.call("scene.open", { file_path: editedProbePath }, CALL_TIMEOUT);
  const editedSceneDelete = await bridge.call("scene.delete", { file_path: editedProbePath }, CALL_TIMEOUT) as { success?: boolean; code?: string; error?: string };
  if (editedSceneDelete?.code !== "EDITED_SCENE") fail(`scene.delete of currently-edited: expected EDITED_SCENE, got ${JSON.stringify(editedSceneDelete)}`);
  else pass("scene.delete refuses currently-edited scene -> EDITED_SCENE");
  const editedSceneClose = await bridge.call("scene.close", { file_path: editedProbePath }, CALL_TIMEOUT) as { success?: boolean };
  if (!editedSceneClose?.success) fail(`edited-probe scene.close: ${JSON.stringify(editedSceneClose)}`);
  await bridge.call("scene.delete", { file_path: editedProbePath }, CALL_TIMEOUT);
  pass("EDITED_SCENE probe: clean teardown via scene.close + scene.delete");

  // script.delete round-trip.
  const scriptDelPath = "res://smoke_throwaway.gd";
  try { await bridge.call("script.delete", { file_path: scriptDelPath }, CALL_TIMEOUT); } catch { /* orphan cleanup */ }
  const scriptWriteResult = await bridge.call("script.write", { file_path: scriptDelPath, content: "extends Node\n" }, CALL_TIMEOUT) as { ok?: boolean };
  if (!scriptWriteResult?.ok) fail(`script.write throwaway.gd: ${JSON.stringify(scriptWriteResult)}`);
  const scriptDeleted = await bridge.call("script.delete", { file_path: scriptDelPath }, CALL_TIMEOUT) as { success?: boolean; path?: string; code?: string };
  if (scriptDeleted?.success !== true || scriptDeleted.path !== scriptDelPath) fail(`script.delete: ${JSON.stringify(scriptDeleted)}`);
  else pass(`script.delete ${scriptDelPath}`);
  const scriptDeleteRepeat = await bridge.call("script.delete", { file_path: scriptDelPath }, CALL_TIMEOUT) as { success?: boolean; code?: string };
  if (scriptDeleteRepeat?.success !== false || scriptDeleteRepeat.code !== "NOT_FOUND") fail(`script.delete repeat: expected NOT_FOUND, got ${JSON.stringify(scriptDeleteRepeat)}`);
  else pass(`script.delete repeat -> NOT_FOUND`);
  assertGuard(ctx, "script.delete .tscn extension", await bridge.call("script.delete", { file_path: "res://bogus.tscn" }, CALL_TIMEOUT), "INVALID_PATH", ".gd");
  assertGuard(ctx, "script.delete .txt extension", await bridge.call("script.delete", { file_path: "res://bogus.txt" }, CALL_TIMEOUT), "INVALID_PATH", ".gd");
}
