// ═════════════════════════════════════════════════════════════════════════
// Smoke test orchestrator — imports and runs 21 self-contained test
// sections sequentially. Each section lives in test/sections/.
//
// Port-check first (iter 05 contract): if the editor plugin isn't
// reachable, print instructions and exit before any assertions.
// ═════════════════════════════════════════════════════════════════════════

import { createBridge } from "../src/bridge.js";

import {
  HOST, PORT, RUNTIME_PORT, PROBE_TIMEOUT_MS,
  probePort, printUnreachable,
} from "./helpers.js";
import type { TestCtx } from "./helpers.js";

import { testCatalogue } from "./sections/01_catalogue.js";
import { testSceneNodeBasics } from "./sections/02_scene_node_basics.js";
import { testScriptOps } from "./sections/03_script_ops.js";
import { testEditorAndSceneNav } from "./sections/04_editor_and_scene_nav.js";
import { testSignalsAndIntrospection } from "./sections/05_signals_and_introspection.js";
import { testSceneDiff } from "./sections/06_scene_diff.js";
import { testErrorContract } from "./sections/07_error_contract.js";
import { testSceneFileLifecycle } from "./sections/08_scene_file_lifecycle.js";
import { testResourceFolderShader } from "./sections/09_resource_folder_shader.js";
import { testPlaytestAndComposition } from "./sections/10_playtest_and_composition.js";
import { testProjectSetSetting } from "./sections/11_project_set_setting.js";
import { testInputMap } from "./sections/12_input_map.js";
import { testAnimationTilemapScreenshot } from "./sections/13_animation_tilemap_screenshot.js";
import { testAssetDiscoveryAndConsole } from "./sections/14_asset_discovery_and_console.js";
import { testAssetImport } from "./sections/15_asset_import.js";
import { testCustomClassAndFileOps } from "./sections/16_custom_class_and_file_ops.js";
import { testModeB } from "./sections/17_mode_b.js";
import { testSecurity } from "./sections/18_security.js";
import { testReconnect } from "./sections/19_reconnect.js";
import { testUserScope } from "./sections/20_user_scope.js";
import { testResponseCaps } from "./sections/21_response_caps.js";

// ─── Expected noise in the Godot editor during a clean smoke run ─────────
//
//   1. Three lines of `Cannot open file 'res://no_such_coerce_smoke.tres' /
//      Failed loading resource … / Error loading resource`. Emitted by the
//      LOAD_FAILED steer assertion (`node.set_property Resource missing
//      path`) — smoke deliberately points at a nonexistent resource to
//      verify the "use resource.create" error message.
//
//   2. Lines `MCP: delete <NodePath>` (e.g. `MCP: delete MCPSmokeAP`).
//      Those are UndoRedo action names printed by EditorUndoRedoManager —
//      scene.delete_node wraps each deletion in an undo action per the
//      godot-mcp-pro / godotiq editor-safety pattern (see plan-repo
//      memory/project_delete_node_crash.md). Not errors.
//
//   3. A single `UndoRedo history mismatch: expected 0, got 1` warning.
//      Benign Godot 4.x message from editor_undo_redo_manager.cpp; fires
//      when the per-scene history counter drifts after the mid-suite
//      save+reload cycle (`scene.instantiate owner-set survives
//      save+reload`). The commit still lands and assertions still pass.
//
// If a "Could not save one or more scenes!" popup reappears, suspect one of:
//   (a) The playtest-and-composition cleanup block — every PackedScene
//       instance of `instChildPath` must be detached from Main BEFORE
//       save_scene, and the scene file deleted only after.
//   (b) A smoke section that opens a scene via scene.open should close
//       the tab via scene.close before deleting the backing file. If
//       scene.close breaks, stale probe files may persist in the toolkit repo.

async function main(): Promise<void> {
  const reachable = await probePort(HOST, PORT, PROBE_TIMEOUT_MS);
  if (!reachable) {
    printUnreachable();
    process.exit(1);
  }

  const bridge = createBridge(`ws://${HOST}:${PORT}`, {
    explicitRuntimePort: String(RUNTIME_PORT),
  });
  let failed = false;
  const ctx: TestCtx = {
    bridge,
    fail: (msg: string) => { console.error(`[smoke] FAIL ${msg}`); failed = true; },
    pass: (msg: string) => console.log(`[smoke] PASS ${msg}`),
  };

  try {
    const { ncmGated } = await testCatalogue(ctx);
    await testSceneNodeBasics(ctx);
    await testScriptOps(ctx);
    await testEditorAndSceneNav(ctx);
    await testSignalsAndIntrospection(ctx);
    await testSceneDiff(ctx);
    await testErrorContract(ctx);
    await testSceneFileLifecycle(ctx);
    await testResourceFolderShader(ctx);
    await testPlaytestAndComposition(ctx, ncmGated);
    await testProjectSetSetting(ctx);
    await testInputMap(ctx);
    await testAnimationTilemapScreenshot(ctx);
    await testAssetDiscoveryAndConsole(ctx);
    await testAssetImport(ctx);
    await testCustomClassAndFileOps(ctx);
    await testModeB(ctx);
    await testSecurity(ctx);
    await testUserScope(ctx);
    await testResponseCaps(ctx);
    await testReconnect(ctx);
  } catch (err) {
    ctx.fail(`unexpected error: ${(err as Error).message}`);
  } finally {
    await bridge.close();
  }

  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error("[smoke] FAIL unexpected:", err);
  process.exit(1);
});
