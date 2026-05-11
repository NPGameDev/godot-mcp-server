// ═══════════════════════════════════════════════════════════════════════════
// Smoke test orchestrator — imports and runs numbered test sections
// sequentially. Each section lives in test/sections/.
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
//   --ci          Static catalogue validation only (no Godot required).
//   --from N      Run sections N and above.
//   --to N        Run sections up to N (inclusive).
//   --only N,M,O  Run only the listed sections (comma-separated).
//
// Section 01 (catalogue) is auto-included when section 10 is selected,
// since it provides the ncmGated flag. Section 19 (reconnect) always
// runs last when included — it drops the connection.
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
import { testTheme } from "./sections/26_theme.js";
import { testAnimationTree } from "./sections/27_animationtree.js";
import { testLayerNames } from "./sections/28_layer_names.js";
import { testPath2d } from "./sections/29_path2d.js";
import { test3dTools } from "./sections/30_3d_tools.js";
import { testCollision } from "./sections/31_collision.js";

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

function parseIntArg(flag: string): number | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  const val = parseInt(process.argv[idx + 1], 10);
  return isNaN(val) ? undefined : val;
}

function parseListArg(flag: string): number[] | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1]
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n));
}

const FROM_SECTION = parseIntArg("--from");
const TO_SECTION = parseIntArg("--to");
const ONLY_SECTIONS = parseListArg("--only");

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

// ─── Section registry ────────────────────────────────────────────────────
// Shared state: section 01 produces ncmGated, section 10 consumes it.
let ncmGated = false;

interface Section {
  num: number;
  name: string;
  run: (ctx: TestCtx) => Promise<void> | void;
}

const ALL_SECTIONS: Section[] = [
  {
    num: 1,
    name: "catalogue",
    run: async (ctx) => {
      ({ ncmGated } = await testCatalogue(ctx));
    },
  },
  { num: 2, name: "scene_node_basics", run: testSceneNodeBasics },
  { num: 3, name: "script_ops", run: testScriptOps },
  { num: 4, name: "editor_and_scene_nav", run: testEditorAndSceneNav },
  { num: 5, name: "signals_and_introspection", run: testSignalsAndIntrospection },
  { num: 6, name: "scene_diff", run: testSceneDiff },
  { num: 7, name: "error_contract", run: testErrorContract },
  { num: 8, name: "scene_file_lifecycle", run: testSceneFileLifecycle },
  { num: 9, name: "resource_folder_shader", run: testResourceFolderShader },
  { num: 10, name: "playtest_and_composition", run: (ctx) => testPlaytestAndComposition(ctx, ncmGated) },
  { num: 11, name: "project_set_setting", run: testProjectSetSetting },
  { num: 12, name: "input_map", run: testInputMap },
  { num: 13, name: "animation_tilemap_screenshot", run: testAnimationTilemapScreenshot },
  { num: 14, name: "asset_discovery_and_console", run: testAssetDiscoveryAndConsole },
  { num: 15, name: "asset_import", run: testAssetImport },
  { num: 16, name: "custom_class_and_file_ops", run: testCustomClassAndFileOps },
  { num: 17, name: "mode_b", run: testModeB },
  { num: 18, name: "security", run: testSecurity },
  { num: 19, name: "reconnect", run: testReconnect },
  { num: 20, name: "user_scope", run: testUserScope },
  { num: 21, name: "response_caps", run: testResponseCaps },
  { num: 22, name: "extensibility", run: testExtensibility },
  { num: 23, name: "classdb", run: testClassdb },
  { num: 24, name: "script_check", run: testScriptCheck },
  { num: 25, name: "csharp_compat", run: testCsharpCompat },
  { num: 26, name: "theme", run: testTheme },
  { num: 27, name: "animationtree", run: testAnimationTree },
  { num: 28, name: "layer_names", run: testLayerNames },
  { num: 29, name: "path2d", run: testPath2d },
  { num: 30, name: "3d_tools", run: test3dTools },
  { num: 31, name: "collision", run: testCollision },
];

function filterSections(): Section[] {
  let filtered: Section[];

  if (ONLY_SECTIONS) {
    const set = new Set(ONLY_SECTIONS);
    filtered = ALL_SECTIONS.filter((s) => set.has(s.num));
  } else if (FROM_SECTION !== undefined || TO_SECTION !== undefined) {
    const from = FROM_SECTION ?? 1;
    const to = TO_SECTION ?? Infinity;
    filtered = ALL_SECTIONS.filter((s) => s.num >= from && s.num <= to);
  } else {
    filtered = [...ALL_SECTIONS];
  }

  // Section 10 depends on ncmGated from section 01
  if (filtered.some((s) => s.num === 10) && !filtered.some((s) => s.num === 1)) {
    filtered.unshift(ALL_SECTIONS[0]);
    console.log("[smoke] Auto-included section 01 (catalogue) — required by section 10\n");
  }

  // Section 19 (reconnect) always runs last — it drops the connection
  const reconnectIdx = filtered.findIndex((s) => s.num === 19);
  if (reconnectIdx !== -1 && reconnectIdx !== filtered.length - 1) {
    const [reconnect] = filtered.splice(reconnectIdx, 1);
    filtered.push(reconnect);
  }

  return filtered;
}

// ─── CI mode: static catalogue validation only ───────────────────────────
async function runCiMode(): Promise<void> {
  console.log("[smoke] CI mode — running static catalogue validation (no Godot required)\n");

  testCatalogueStatic({ pass: passFn, fail: failFn });

  printSummary();
  process.exit(failCount > 0 ? 1 : 0);
}

// ─── Full mode: port probe + filtered test sections ─────────────────────
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

  const sections = filterSections();
  const nums = sections.map((s) => s.num);
  if (ONLY_SECTIONS || FROM_SECTION !== undefined || TO_SECTION !== undefined) {
    console.log(`[smoke] Running sections: ${nums.join(", ")}\n`);
  }

  try {
    for (const section of sections) {
      await section.run(ctx);
    }
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
