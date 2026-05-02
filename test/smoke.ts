// ═══════════════════════════════════════════════════════════════════════════
// Smoke test orchestrator — imports and runs 25 self-contained test
// sections sequentially. Each section lives in test/sections/.
//
// Port-check first: if the editor plugin isn't reachable, print
// instructions and exit before any assertions.
//
// Exit codes:
//   0 — all tests passed
//   1 — one or more tests failed
//   2 — precondition failure (Godot not running, port not listening, etc.)
//
// Flags:
//   --ci  Skip the port check and run only static catalogue/registration
//         validation (no Godot calls). Useful in CI where no editor runs.
// ═══════════════════════════════════════════════════════════════════════════

import { createBridge } from "../src/bridge.js";
import { registryPath } from "../src/registry.js";
import { readFileSync } from "node:fs";

import { HOST, PORT, RUNTIME_PORT, PROBE_TIMEOUT_MS, probePort, printUnreachable } from "./helpers.js";
import type { TestCtx } from "./helpers.js";

import { testCatalogue, testCatalogueStatic } from "./sections/01_catalogue.js";
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
import { testExtensibility } from "./sections/22_extensibility.js";
import { testClassdb } from "./sections/23_classdb.js";
import { testScriptCheck } from "./sections/24_script_check.js";
import { testCsharpCompat } from "./sections/25_csharp_compat.js";

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

// ─── CLI flag parsing ────────────────────────────────────────────────────
const CI_MODE = process.argv.includes("--ci");

// ─── Counters ────────────────────────────────────────────────────────────
let passCount = 0;
let failCount = 0;

function passFn(msg: string): void {
  passCount++;
  console.log(`[smoke] PASS  ${msg}`);
}

function failFn(msg: string): void {
  failCount++;
  console.error(`[smoke] FAIL  ${msg}`);
}

function printSummary(): void {
  const total = passCount + failCount;
  const bar = "-".repeat(50);
  console.log(`\n${bar}`);
  console.log(`Smoke: ${passCount} passed, ${failCount} failed, ${total} total`);
  console.log(bar);
}

// Discover the project path for the editor listening on PORT so the bridge
// can derive the per-worktree token filename. Prefers env var, then
// searches the registry for a matching port entry.
function discoverProjectPath(): string | undefined {
  const envPath = process.env.GODOT_MCP_PROJECT_PATH;
  if (envPath) return envPath;
  try {
    const data = JSON.parse(readFileSync(registryPath(), "utf-8")) as {
      by_path?: Record<string, { port?: number }>;
    };
    for (const [path, entry] of Object.entries(data.by_path ?? {})) {
      if (entry.port === PORT) return path;
    }
  } catch {
    // Registry unreadable — fall through.
  }
  return undefined;
}

// ─── CI mode: static catalogue validation only ───────────────────────────
async function runCiMode(): Promise<void> {
  console.log("[smoke] CI mode — running static catalogue validation (no Godot required)\n");

  testCatalogueStatic({ pass: passFn, fail: failFn });

  printSummary();
  process.exit(failCount > 0 ? 1 : 0);
}

// ─── Full mode: port probe + all test sections ───────────────────────────
async function runFullMode(): Promise<void> {
  const reachable = await probePort(HOST, PORT, PROBE_TIMEOUT_MS);
  if (!reachable) {
    printUnreachable();
    process.exit(2);
  }

  const projectPath = discoverProjectPath();
  const bridge = createBridge(`ws://${HOST}:${PORT}`, {
    projectPath,
    explicitRuntimePort: String(RUNTIME_PORT),
  });
  const ctx: TestCtx = {
    bridge,
    fail: failFn,
    pass: passFn,
    projectPath,
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
    await testExtensibility(ctx);
    await testClassdb(ctx);
    await testScriptCheck(ctx);
    await testCsharpCompat(ctx);
    await testReconnect(ctx);
  } catch (err) {
    failFn(`unexpected error: ${(err as Error).message}`);
  } finally {
    await bridge.close();
  }

  printSummary();
  process.exit(failCount > 0 ? 1 : 0);
}

// ─── Entry ───────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  if (CI_MODE) {
    await runCiMode();
  } else {
    await runFullMode();
  }
}

main().catch((err) => {
  console.error("[smoke] FAIL unexpected:", err);
  process.exit(2);
});
