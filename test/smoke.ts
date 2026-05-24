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
//   --ci              Static catalogue validation only (no Godot required).
//   --from N          Run sections N and above.
//   --to N            Run sections up to N (inclusive).
//   --only N,M,O      Run only the listed sections (comma-separated).
//   --gates-on-skip   Skip sections that don't export isAffectedByGates.
//                     Used by run-smoke.ts pass 2 (gates ON) to run only
//                     gate-affected sections.
//
// Section 01 (catalogue) is auto-included when section 11 is selected,
// since it provides the ncmGated flag. Section 20 (reconnect) always
// runs last when included — it drops the connection.
// ═══════════════════════════════════════════════════════════════════════════

import { createBridge } from "../src/bridge.js";
import { registryPath } from "../src/registry.js";
import { readFileSync } from "node:fs";

import { HOST, PORT, RUNTIME_PORT, PROBE_TIMEOUT_MS, probePort, printUnreachable } from "./helpers.js";
import type { TestCtx } from "./helpers.js";

import { runStructuralChecks } from "./structural.js";
import * as sec01 from "./sections/01_catalogue.js";
import * as sec02 from "./sections/02_gate_enforcement.js";
import * as sec03 from "./sections/03_scene_node_basics.js";
import * as sec04 from "./sections/04_script_ops.js";
import * as sec05 from "./sections/05_editor_and_scene_nav.js";
import * as sec06 from "./sections/06_signals_and_introspection.js";
import * as sec07 from "./sections/07_scene_diff.js";
import * as sec08 from "./sections/08_error_contract.js";
import * as sec09 from "./sections/09_scene_file_lifecycle.js";
import * as sec10 from "./sections/10_resource_folder_shader.js";
import * as sec11 from "./sections/11_playtest_and_composition.js";
import * as sec12 from "./sections/12_project_set_setting.js";
import * as sec13 from "./sections/13_input_map.js";
import * as sec14 from "./sections/14_animation_tilemap_screenshot.js";
import * as sec15 from "./sections/15_asset_discovery_and_console.js";
import * as sec16 from "./sections/16_asset_import.js";
import * as sec17 from "./sections/17_custom_class_and_file_ops.js";
import * as sec18 from "./sections/18_mode_b.js";
import * as sec19 from "./sections/19_security.js";
import * as sec20 from "./sections/20_reconnect.js";
import * as sec21 from "./sections/21_user_scope.js";
import * as sec22 from "./sections/22_response_caps.js";
import * as sec23 from "./sections/23_extensibility.js";
import * as sec24 from "./sections/24_classdb.js";
import * as sec25 from "./sections/25_script_check.js";
import * as sec26 from "./sections/26_csharp_compat.js";
import * as sec27 from "./sections/27_theme.js";
import * as sec28 from "./sections/28_animationtree.js";
import * as sec29 from "./sections/29_layer_names.js";
import * as sec30 from "./sections/30_path2d.js";
import * as sec31 from "./sections/31_3d_tools.js";
import * as sec32 from "./sections/32_collision.js";
import * as sec33 from "./sections/33_procedural.js";
import * as sec34 from "./sections/34_scene_inheritance.js";
import * as sec35 from "./sections/35_audiobus.js";
import * as sec36 from "./sections/36_spriteframes.js";
import * as sec37 from "./sections/37_scene_query.js";
import * as sec38 from "./sections/38_particles.js";
import * as sec39 from "./sections/39_navigation.js";
import * as sec40 from "./sections/40_discover_tools.js";
import * as sec41 from "./sections/41_crash_detection.js";
import * as sec42 from "./sections/42_lsp.js";
import * as sec43 from "./sections/43_debugger.js";
import * as sec44 from "./sections/44_control_layout.js";

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
const GATES_ON_SKIP = process.argv.includes("--gates-on-skip");

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
const SKIP_SECTIONS = parseListArg("--skip");

// ─── Counters ────────────────────────────────────────────────────────────
let passCount = 0;
let failCount = 0;
let skipCount = 0;

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
  const skipMsg = skipCount > 0 ? `, ${skipCount} skipped` : "";
  console.log(`Smoke: ${passCount} passed, ${failCount} failed${skipMsg}, ${total} total`);
  console.log(bar);
}

// Discover the project path for the editor listening on PORT so the bridge
// can derive the per-worktree token filename. Prefers env var, then
// searches the registry for a matching port entry.  When multiple entries
// share the same port (stale leftover from a dead editor), prefer the one
// with the highest started_at timestamp and filter out dead PIDs.
function discoverProjectPath(): string | undefined {
  const envPath = process.env.GODOT_MCP_PROJECT_PATH;
  if (envPath) return envPath;
  try {
    const data = JSON.parse(readFileSync(registryPath(), "utf-8")) as {
      by_path?: Record<string, { port?: number; started_at?: number; pid?: number }>;
    };
    let best: { path: string; startedAt: number } | undefined;
    for (const [path, entry] of Object.entries(data.by_path ?? {})) {
      if (entry.port !== PORT) continue;
      // Filter out entries whose PID is provably dead.
      if (entry.pid != null && entry.pid > 0) {
        try {
          process.kill(entry.pid, 0);
        } catch {
          continue; // PID dead — skip stale entry.
        }
      }
      const ts = entry.started_at ?? 0;
      if (!best || ts > best.startedAt) {
        best = { path, startedAt: ts };
      }
    }
    return best?.path;
  } catch {
    // Registry unreadable — fall through.
  }
  return undefined;
}

// ─── Section registry ────────────────────────────────────────────────────
// Shared state: section 01 produces ncmGated, section 11 consumes it.
let ncmGated = false;

interface Section {
  num: number;
  name: string;
  run: (ctx: TestCtx) => Promise<void> | void;
  gateAffected?: boolean;
}

const ALL_SECTIONS: Section[] = [
  {
    num: 1,
    name: "catalogue",
    gateAffected: (sec01 as { isAffectedByGates?: boolean }).isAffectedByGates,
    run: async (ctx) => {
      ({ ncmGated } = await sec01.testCatalogue(ctx));
    },
  },
  { num: 2, name: "gate_enforcement", run: sec02.testGateEnforcement },
  { num: 3, name: "scene_node_basics", run: sec03.testSceneNodeBasics },
  { num: 4, name: "script_ops", run: sec04.testScriptOps },
  { num: 5, name: "editor_and_scene_nav", run: sec05.testEditorAndSceneNav },
  { num: 6, name: "signals_and_introspection", run: sec06.testSignalsAndIntrospection },
  { num: 7, name: "scene_diff", run: sec07.testSceneDiff },
  { num: 8, name: "error_contract", run: sec08.testErrorContract },
  { num: 9, name: "scene_file_lifecycle", run: sec09.testSceneFileLifecycle },
  { num: 10, name: "resource_folder_shader", run: sec10.testResourceFolderShader },
  {
    num: 11,
    name: "playtest_and_composition",
    gateAffected: (sec11 as { isAffectedByGates?: boolean }).isAffectedByGates,
    run: (ctx) => sec11.testPlaytestAndComposition(ctx, ncmGated),
  },
  {
    num: 12,
    name: "project_set_setting",
    gateAffected: (sec12 as { isAffectedByGates?: boolean }).isAffectedByGates,
    run: sec12.testProjectSetSetting,
  },
  {
    num: 13,
    name: "input_map",
    gateAffected: (sec13 as { isAffectedByGates?: boolean }).isAffectedByGates,
    run: sec13.testInputMap,
  },
  { num: 14, name: "animation_tilemap_screenshot", run: sec14.testAnimationTilemapScreenshot },
  { num: 15, name: "asset_discovery_and_console", run: sec15.testAssetDiscoveryAndConsole },
  { num: 16, name: "asset_import", run: sec16.testAssetImport },
  { num: 17, name: "custom_class_and_file_ops", run: sec17.testCustomClassAndFileOps },
  {
    num: 18,
    name: "mode_b",
    gateAffected: (sec18 as { isAffectedByGates?: boolean }).isAffectedByGates,
    run: sec18.testModeB,
  },
  { num: 19, name: "security", run: sec19.testSecurity },
  { num: 20, name: "reconnect", run: sec20.testReconnect },
  {
    num: 21,
    name: "user_scope",
    gateAffected: (sec21 as { isAffectedByGates?: boolean }).isAffectedByGates,
    run: sec21.testUserScope,
  },
  { num: 22, name: "response_caps", run: sec22.testResponseCaps },
  { num: 23, name: "extensibility", run: sec23.testExtensibility },
  { num: 24, name: "classdb", run: sec24.testClassdb },
  { num: 25, name: "script_check", run: sec25.testScriptCheck },
  { num: 26, name: "csharp_compat", run: sec26.testCsharpCompat },
  { num: 27, name: "theme", run: sec27.testTheme },
  { num: 28, name: "animationtree", run: sec28.testAnimationTree },
  { num: 29, name: "layer_names", run: sec29.testLayerNames },
  { num: 30, name: "path2d", run: sec30.testPath2d },
  { num: 31, name: "3d_tools", run: sec31.test3dTools },
  { num: 32, name: "collision", run: sec32.testCollision },
  { num: 33, name: "procedural", run: sec33.testProcedural },
  { num: 34, name: "scene_inheritance", run: sec34.testSceneInheritance },
  { num: 35, name: "audiobus", run: sec35.testAudiobus },
  { num: 36, name: "spriteframes", run: sec36.testSpriteframes },
  { num: 37, name: "scene_query", run: sec37.testSceneQuery },
  { num: 38, name: "particles", run: sec38.testParticles },
  { num: 39, name: "navigation", run: sec39.testNavigation },
  { num: 40, name: "discover_tools", run: sec40.testDiscoverTools },
  { num: 41, name: "crash_detection", run: sec41.testCrashDetection },
  { num: 42, name: "lsp", run: sec42.testLsp },
  { num: 43, name: "debugger", run: sec43.testDebugger },
  { num: 44, name: "control_layout", run: sec44.testControlLayout },
];

function filterSections(): Section[] {
  let filtered: Section[];

  if (ONLY_SECTIONS) {
    const set = new Set(ONLY_SECTIONS);
    filtered = ALL_SECTIONS.filter((s) => set.has(s.num));
    if (SKIP_SECTIONS) {
      console.log("[smoke] WARNING: --skip ignored when --only is set\n");
    }
  } else if (FROM_SECTION !== undefined || TO_SECTION !== undefined) {
    const from = FROM_SECTION ?? 1;
    const to = TO_SECTION ?? Infinity;
    filtered = ALL_SECTIONS.filter((s) => s.num >= from && s.num <= to);
  } else {
    filtered = [...ALL_SECTIONS];
  }

  // Section 11 depends on ncmGated from section 01
  if (filtered.some((s) => s.num === 11) && !filtered.some((s) => s.num === 1)) {
    filtered.unshift(ALL_SECTIONS[0]);
    console.log("[smoke] Auto-included section 01 (catalogue) — required by section 11\n");
  }

  // --skip post-filter: applied after base set + auto-include, so explicit
  // skips always win (even over auto-included sections).
  if (SKIP_SECTIONS && !ONLY_SECTIONS) {
    const skipSet = new Set(SKIP_SECTIONS);
    const skippedNums: number[] = [];
    filtered = filtered.filter((s) => {
      if (skipSet.has(s.num)) {
        skippedNums.push(s.num);
        return false;
      }
      return true;
    });
    if (skippedNums.length > 0) {
      console.log(`[smoke] --skip: excluded sections ${skippedNums.join(", ")}`);
    }
    // Warn if skip removed auto-included section 01 while section 11 remains.
    if (skipSet.has(1) && filtered.some((s) => s.num === 11)) {
      console.log(
        "[smoke] WARNING: section 01 skipped but section 11 is included — 11 may fail without catalogue data\n",
      );
    }
  }

  // Section 20 (reconnect) always runs last — it drops the connection
  const reconnectIdx = filtered.findIndex((s) => s.num === 20);
  if (reconnectIdx !== -1 && reconnectIdx !== filtered.length - 1) {
    const [reconnect] = filtered.splice(reconnectIdx, 1);
    filtered.push(reconnect);
  }

  return filtered;
}

// ─── CI mode: static catalogue validation only ───────────────────────────
async function runCiMode(): Promise<void> {
  console.log("[smoke] CI mode — running static catalogue validation (no Godot required)\n");

  sec01.testCatalogueStatic({ pass: passFn, fail: failFn });
  runStructuralChecks({ pass: passFn, fail: failFn });

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
  if (ONLY_SECTIONS || FROM_SECTION !== undefined || TO_SECTION !== undefined || SKIP_SECTIONS) {
    console.log(`[smoke] Running sections: ${nums.join(", ")}\n`);
  }
  if (GATES_ON_SKIP) {
    console.log("[smoke] --gates-on-skip active: skipping non-gate-affected sections\n");
  }

  try {
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      if (GATES_ON_SKIP && !section.gateAffected) {
        skipCount++;
        console.log(
          `[smoke] SKIP  section ${String(section.num).padStart(2, "0")} — ${section.name} (not gate-affected)`,
        );
        continue;
      }
      // Brief pause between sections so the Godot editor can process
      // deferred calls and free resources. Without this, 450+ rapid-fire
      // tool calls can overwhelm the editor's _process() loop and cause
      // crashes from accumulated deferred-call pressure.
      if (i > 0) await new Promise((r) => setTimeout(r, 150));
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
