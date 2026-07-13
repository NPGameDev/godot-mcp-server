import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, assertGuard } from "../helpers.js";
import { isVersionAtLeast } from "../../src/shared/version.js";

export const TOOLS_TESTED: string[] = [
  "scene_create",
  "scene_delete",
  "script_write",
  "script_delete",
  "resource_write",
  "resource_delete",
  "folder_create",
  "folder_delete",
];
export async function testSceneFileLifecycle(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  const scenePath = "res://smoke_throwaway.tscn";
  try {
    await bridge.call("scene.delete", { file_path: scenePath }, CALL_TIMEOUT);
  } catch {
    /* orphan cleanup */
  }

  // Fresh create.
  const sceneCreated = (await bridge.call(
    "scene.create",
    { file_path: scenePath, root_type: "Node2D" },
    CALL_TIMEOUT,
  )) as { success?: boolean; status?: string; path?: string; root_type?: string; code?: string };
  if (sceneCreated?.status !== "created" || sceneCreated.path !== scenePath || sceneCreated.root_type !== "Node2D") {
    fail(
      `scene.create fresh: expected status='created' path=${scenePath} root_type='Node2D', got ${JSON.stringify(sceneCreated)}`,
    );
  } else pass(`scene.create fresh -> status='created' root_type=Node2D`);

  // Default if_exists (return).
  const sceneReturned = (await bridge.call(
    "scene.create",
    { file_path: scenePath, root_type: "Node2D" },
    CALL_TIMEOUT,
  )) as { success?: boolean; status?: string; path?: string; code?: string };
  if (sceneReturned?.status !== "returned" || sceneReturned.path !== scenePath) {
    fail(`scene.create default if_exists repeat: expected status='returned', got ${JSON.stringify(sceneReturned)}`);
  } else if (sceneReturned.code !== undefined)
    fail(`scene.create returned must not carry code (got ${sceneReturned.code})`);
  else pass(`scene.create default repeat -> status='returned' (code absent)`);

  // if_exists: fail.
  const sceneFailed = (await bridge.call(
    "scene.create",
    { file_path: scenePath, root_type: "Node2D", if_exists: "fail" },
    CALL_TIMEOUT,
  )) as { success?: boolean; code?: string; error?: string };
  if (
    sceneFailed?.success !== false ||
    sceneFailed.code !== "ALREADY_EXISTS" ||
    !sceneFailed.error?.includes("replace")
  ) {
    fail(
      `scene.create if_exists=fail: expected ALREADY_EXISTS mentioning 'replace', got ${JSON.stringify(sceneFailed)}`,
    );
  } else pass(`scene.create if_exists='fail' -> ALREADY_EXISTS (message steers to 'replace')`);

  // if_exists: replace.
  const sceneReplaced = (await bridge.call(
    "scene.create",
    { file_path: scenePath, root_type: "Node3D", if_exists: "replace" },
    CALL_TIMEOUT,
  )) as {
    success?: boolean;
    status?: string;
    path?: string;
    root_type?: string;
    previous_root_type?: string;
    code?: string;
  };
  if (
    sceneReplaced?.status !== "replaced" ||
    sceneReplaced.root_type !== "Node3D" ||
    sceneReplaced.previous_root_type !== "Node2D"
  ) {
    fail(
      `scene.create if_exists=replace: expected status='replaced' root_type=Node3D prev=Node2D, got ${JSON.stringify(sceneReplaced)}`,
    );
  } else pass(`scene.create if_exists='replace' -> status='replaced' prev=${sceneReplaced.previous_root_type}`);

  // Invalid if_exists.
  const sceneBadIfExists = (await bridge.call(
    "scene.create",
    { file_path: scenePath, root_type: "Node", if_exists: "explode" },
    CALL_TIMEOUT,
  )) as { success?: boolean; code?: string; error?: string };
  if (sceneBadIfExists?.code !== "INVALID_PARAMS" || !sceneBadIfExists.error?.includes("if_exists")) {
    fail(`scene.create invalid if_exists: expected INVALID_PARAMS, got ${JSON.stringify(sceneBadIfExists)}`);
  } else pass(`scene.create if_exists='explode' -> INVALID_PARAMS`);

  // root_name: explicit override is honored; omission falls back to the filename stem.
  const rootNamePath = "res://smoke_root_name.tscn";
  const rootStemPath = "res://smoke_root_stem.tscn";
  try {
    await bridge.call("scene.delete", { file_path: rootNamePath }, CALL_TIMEOUT);
    await bridge.call("scene.delete", { file_path: rootStemPath }, CALL_TIMEOUT);
  } catch {
    /* orphan cleanup */
  }
  const rootNameOverride = (await bridge.call(
    "scene.create",
    { file_path: rootNamePath, root_type: "Node2D", root_name: "CustomRoot" },
    CALL_TIMEOUT,
  )) as { success?: boolean; status?: string; root_name?: string };
  if (rootNameOverride?.status !== "created" || rootNameOverride.root_name !== "CustomRoot") {
    fail(`scene.create root_name override: expected root_name='CustomRoot', got ${JSON.stringify(rootNameOverride)}`);
  } else pass(`scene.create root_name='CustomRoot' -> override honored`);
  const rootNameDefault = (await bridge.call(
    "scene.create",
    { file_path: rootStemPath, root_type: "Node2D" },
    CALL_TIMEOUT,
  )) as { success?: boolean; root_name?: string };
  if (rootNameDefault?.root_name !== "smoke_root_stem") {
    fail(`scene.create root_name omitted: expected stem 'smoke_root_stem', got ${JSON.stringify(rootNameDefault)}`);
  } else pass(`scene.create root_name omitted -> stem 'smoke_root_stem'`);
  try {
    await bridge.call("scene.delete", { file_path: rootNamePath }, CALL_TIMEOUT);
    await bridge.call("scene.delete", { file_path: rootStemPath }, CALL_TIMEOUT);
  } catch {
    /* best-effort cleanup */
  }

  // Guard rejections.
  assertGuard(
    ctx,
    "scene.create /tmp path",
    await bridge.call("scene.create", { file_path: "/tmp/foo.tscn", root_type: "Node" }, CALL_TIMEOUT),
    "PATH_DENIED",
    "absolute",
  );
  assertGuard(
    ctx,
    "scene.create .txt extension",
    await bridge.call("scene.create", { file_path: "res://foo.txt", root_type: "Node" }, CALL_TIMEOUT),
    "INVALID_PATH",
    ".tscn",
  );
  // Auto-create parent dirs: should succeed with dirs_created:true.
  // Pre-clean in case a prior pass left stale data.
  try {
    await bridge.call("scene.delete", { file_path: "res://nonexistent_smoke_dir/foo.tscn" }, CALL_TIMEOUT);
    await bridge.call("folder.delete", { path: "res://nonexistent_smoke_dir", recursive: true }, CALL_TIMEOUT);
  } catch {
    /* best-effort pre-clean */
  }
  const autoDir = (await bridge.call(
    "scene.create",
    { file_path: "res://nonexistent_smoke_dir/foo.tscn", root_type: "Node" },
    CALL_TIMEOUT,
  )) as { success?: boolean; dirs_created?: boolean; status?: string };
  if (autoDir?.success !== true || autoDir.dirs_created !== true || autoDir.status !== "created") {
    ctx.fail(`scene.create auto-create dirs: expected success+dirs_created, got ${JSON.stringify(autoDir)}`);
  } else {
    ctx.pass("scene.create auto-create dirs -> success + dirs_created");
  }
  // Cleanup auto-created file + directory.
  try {
    await bridge.call("scene.delete", { file_path: "res://nonexistent_smoke_dir/foo.tscn" }, CALL_TIMEOUT);
    await bridge.call("folder.delete", { path: "res://nonexistent_smoke_dir", recursive: true }, CALL_TIMEOUT);
  } catch {
    /* best-effort cleanup */
  }
  assertGuard(
    ctx,
    "scene.create bogus class",
    await bridge.call("scene.create", { file_path: "res://smoke_bogus.tscn", root_type: "BogusClass" }, CALL_TIMEOUT),
    "INVALID_CLASS",
    ["ClassDB", "ProjectSettings"],
  );
  assertGuard(
    ctx,
    "scene.create Resource (not a Node)",
    await bridge.call("scene.create", { file_path: "res://smoke_resource.tscn", root_type: "Resource" }, CALL_TIMEOUT),
    "INVALID_CLASS",
    "Node",
  );

  // scene.delete round-trip (file not open in any tab).
  const sceneDeleted = (await bridge.call("scene.delete", { file_path: scenePath }, CALL_TIMEOUT)) as {
    success?: boolean;
    path?: string;
    tab_closed?: boolean;
    code?: string;
  };
  if (sceneDeleted?.success !== true || sceneDeleted.path !== scenePath)
    fail(`scene.delete: ${JSON.stringify(sceneDeleted)}`);
  else if (sceneDeleted.tab_closed !== false)
    fail(`scene.delete tab_closed: expected false (not open), got ${JSON.stringify(sceneDeleted.tab_closed)}`);
  else pass(`scene.delete ${scenePath} (tab_closed:false)`);
  const sceneDeleteRepeat = (await bridge.call("scene.delete", { file_path: scenePath }, CALL_TIMEOUT)) as {
    success?: boolean;
    code?: string;
  };
  if (sceneDeleteRepeat?.success !== false || sceneDeleteRepeat.code !== "NOT_FOUND")
    fail(`scene.delete repeat: expected NOT_FOUND, got ${JSON.stringify(sceneDeleteRepeat)}`);
  else pass(`scene.delete repeat -> NOT_FOUND`);
  assertGuard(
    ctx,
    "scene.delete .txt extension",
    await bridge.call("scene.delete", { file_path: "res://bogus.txt" }, CALL_TIMEOUT),
    "INVALID_PATH",
    ".tscn",
  );

  // Version-branched: scene.delete of the active scene.
  // 4.5+: auto-closes tab, returns success + tab_closed:true.
  // 4.2-4.4: returns EDITED_SCENE (no close API for active tab).
  const godotVer = bridge.getGodotVersion();
  const editedProbePath = "res://smoke_edited_probe.tscn";
  await bridge.call(
    "scene.create",
    { file_path: editedProbePath, root_type: "Node", if_exists: "return" },
    CALL_TIMEOUT,
  );
  await bridge.call("scene.open", { file_path: editedProbePath }, CALL_TIMEOUT);
  const editedSceneDelete = (await bridge.call("scene.delete", { file_path: editedProbePath }, CALL_TIMEOUT)) as {
    success?: boolean;
    tab_closed?: boolean;
    code?: string;
    warnings?: string[];
  };
  if (godotVer != null && isVersionAtLeast(godotVer, "4.5")) {
    // 4.5+: tab auto-closed, file deleted.
    if (editedSceneDelete?.success !== true || editedSceneDelete.tab_closed !== true)
      fail(
        `scene.delete active tab (4.5+): expected success+tab_closed:true, got ${JSON.stringify(editedSceneDelete)}`,
      );
    else pass("scene.delete auto-closes active tab on 4.5+ (tab_closed:true)");
  } else {
    // 4.2-4.4: EDITED_SCENE refusal.
    if (editedSceneDelete?.code !== "EDITED_SCENE")
      fail(`scene.delete active tab (4.2-4.4): expected EDITED_SCENE, got ${JSON.stringify(editedSceneDelete)}`);
    else pass("scene.delete refuses active tab on 4.2-4.4 -> EDITED_SCENE");
    // Clean up: close + delete on 4.2-4.4 (scene.close only works on active tab there).
    try {
      // scene.close returns UNSUPPORTED on 4.2-4.4, so we just open another scene to switch away.
      await bridge.call("scene.open", { file_path: scenePath }, CALL_TIMEOUT);
    } catch {
      /* best-effort */
    }
    try {
      await bridge.call("scene.delete", { file_path: editedProbePath }, CALL_TIMEOUT);
    } catch {
      /* best-effort cleanup */
    }
  }

  // scene.close: non-active tab (4.5+ only — requires close_scene API).
  if (godotVer != null && isVersionAtLeast(godotVer, "4.5")) {
    const closeProbeA = "res://smoke_close_a.tscn";
    const closeProbeB = "res://smoke_close_b.tscn";
    try {
      await bridge.call("scene.delete", { file_path: closeProbeA }, CALL_TIMEOUT);
      await bridge.call("scene.delete", { file_path: closeProbeB }, CALL_TIMEOUT);
    } catch {
      /* orphan cleanup */
    }
    await bridge.call("scene.create", { file_path: closeProbeA, root_type: "Node", if_exists: "return" }, CALL_TIMEOUT);
    await bridge.call("scene.create", { file_path: closeProbeB, root_type: "Node", if_exists: "return" }, CALL_TIMEOUT);
    await bridge.call("scene.open", { file_path: closeProbeA }, CALL_TIMEOUT);
    await bridge.call("scene.open", { file_path: closeProbeB }, CALL_TIMEOUT);
    // closeProbeB is now active; close non-active closeProbeA.
    const closeNonActive = (await bridge.call("scene.close", { file_path: closeProbeA }, CALL_TIMEOUT)) as {
      success?: boolean;
    };
    if (!closeNonActive?.success) fail(`scene.close non-active tab: ${JSON.stringify(closeNonActive)}`);
    else pass("scene.close closes non-active tab");
    // Cleanup.
    try {
      await bridge.call("scene.close", { file_path: closeProbeB }, CALL_TIMEOUT);
    } catch {
      /* best-effort */
    }
    try {
      await bridge.call("scene.delete", { file_path: closeProbeA }, CALL_TIMEOUT);
      await bridge.call("scene.delete", { file_path: closeProbeB }, CALL_TIMEOUT);
    } catch {
      /* best-effort cleanup */
    }
  } else {
    pass("scene.close non-active tab -> SKIP (requires 4.5+)");
  }

  // script.delete round-trip.
  const scriptDelPath = "res://smoke_throwaway.gd";
  try {
    await bridge.call("script.delete", { file_path: scriptDelPath }, CALL_TIMEOUT);
  } catch {
    /* orphan cleanup */
  }
  const scriptWriteResult = (await bridge.call(
    "script.write",
    { file_path: scriptDelPath, content: "extends Node\n" },
    CALL_TIMEOUT,
  )) as { success?: boolean };
  if (!scriptWriteResult?.success) fail(`script.write throwaway.gd: ${JSON.stringify(scriptWriteResult)}`);
  const scriptDeleted = (await bridge.call("script.delete", { file_path: scriptDelPath }, CALL_TIMEOUT)) as {
    success?: boolean;
    path?: string;
    code?: string;
  };
  if (scriptDeleted?.success !== true || scriptDeleted.path !== scriptDelPath)
    fail(`script.delete: ${JSON.stringify(scriptDeleted)}`);
  else pass(`script.delete ${scriptDelPath}`);
  const scriptDeleteRepeat = (await bridge.call("script.delete", { file_path: scriptDelPath }, CALL_TIMEOUT)) as {
    success?: boolean;
    code?: string;
  };
  if (scriptDeleteRepeat?.success !== false || scriptDeleteRepeat.code !== "NOT_FOUND")
    fail(`script.delete repeat: expected NOT_FOUND, got ${JSON.stringify(scriptDeleteRepeat)}`);
  else pass(`script.delete repeat -> NOT_FOUND`);
  assertGuard(
    ctx,
    "script.delete .tscn extension",
    await bridge.call("script.delete", { file_path: "res://bogus.tscn" }, CALL_TIMEOUT),
    "INVALID_PATH",
    ".gd",
  );
  assertGuard(
    ctx,
    "script.delete .txt extension",
    await bridge.call("script.delete", { file_path: "res://bogus.txt" }, CALL_TIMEOUT),
    "INVALID_PATH",
    ".gd",
  );
}
