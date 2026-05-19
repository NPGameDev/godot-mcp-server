/**
 * Structural validation checks for the tool catalogue.
 * Runs in CI mode (no Godot required). Validates schema integrity,
 * test coverage, annotation completeness, and naming conventions
 * across the UNFILTERED tool catalogue (all tools regardless of gate state).
 *
 * Grilling decision (2026-05-19): 4 checks, standalone module.
 * See Plan/ExecutionPlan/41l-sexies-bis-ci-static-smoke-expansion.md.
 */

import { z } from "zod";
import type { ToolDef } from "../src/types.js";
import { MUTATING_TOOLS } from "../src/profiles.js";

// ── Import ALL tool arrays (eagerly-registered + group-loaded) ──────
import { sceneTools } from "../src/tools/scene.js";
import { nodeTools } from "../src/tools/node.js";
import { scriptTools } from "../src/tools/script.js";
import { editorTools } from "../src/tools/editor.js";
import { runtimeTools } from "../src/tools/runtime.js";
import { signalTools } from "../src/tools/signals.js";
import { resourceTools } from "../src/tools/resource.js";
import { folderTools } from "../src/tools/folder.js";
import { diffTools } from "../src/tools/diff.js";
import { playtestTools } from "../src/tools/playtest.js";
import { inputMapTools } from "../src/tools/input_map.js";
import { animationTools } from "../src/tools/animation.js";
import { tilemapTools } from "../src/tools/tilemap.js";
import { assetTools } from "../src/tools/asset.js";
import { fileTools } from "../src/tools/file.js";
import { saveTools } from "../src/tools/save.js";
import { classdbTools } from "../src/tools/classdb.js";
import { nodeManagementTools } from "../src/tools/node_management.js";
import { themeTools } from "../src/tools/theme.js";
import { layerNameTools } from "../src/tools/layer_names.js";
import { pathTools } from "../src/tools/path.js";
import { collisionTools } from "../src/tools/collision.js";
import { threeDTools } from "../src/tools/three_d.js";
import { proceduralTools } from "../src/tools/procedural.js";
import { sceneInheritanceTools } from "../src/tools/scene_inheritance.js";
import { audioTools } from "../src/tools/audio.js";
import { spriteframesTools } from "../src/tools/spriteframes.js";
import { sceneQueryTools } from "../src/tools/scene_query.js";
import { particleTools } from "../src/tools/particles.js";
import { navigationTools } from "../src/tools/navigation.js";
import { lspTools } from "../src/tools/lsp.js";
import { debugTools } from "../src/tools/debug.js";

// ── Import TOOLS_TESTED from all 43 sections ────────────────────────
import { TOOLS_TESTED as T01 } from "./sections/01_catalogue.js";
import { TOOLS_TESTED as T02 } from "./sections/02_gate_enforcement.js";
import { TOOLS_TESTED as T03 } from "./sections/03_scene_node_basics.js";
import { TOOLS_TESTED as T04 } from "./sections/04_script_ops.js";
import { TOOLS_TESTED as T05 } from "./sections/05_editor_and_scene_nav.js";
import { TOOLS_TESTED as T06 } from "./sections/06_signals_and_introspection.js";
import { TOOLS_TESTED as T07 } from "./sections/07_scene_diff.js";
import { TOOLS_TESTED as T08 } from "./sections/08_error_contract.js";
import { TOOLS_TESTED as T09 } from "./sections/09_scene_file_lifecycle.js";
import { TOOLS_TESTED as T10 } from "./sections/10_resource_folder_shader.js";
import { TOOLS_TESTED as T11 } from "./sections/11_playtest_and_composition.js";
import { TOOLS_TESTED as T12 } from "./sections/12_project_set_setting.js";
import { TOOLS_TESTED as T13 } from "./sections/13_input_map.js";
import { TOOLS_TESTED as T14 } from "./sections/14_animation_tilemap_screenshot.js";
import { TOOLS_TESTED as T15 } from "./sections/15_asset_discovery_and_console.js";
import { TOOLS_TESTED as T16 } from "./sections/16_asset_import.js";
import { TOOLS_TESTED as T17 } from "./sections/17_custom_class_and_file_ops.js";
import { TOOLS_TESTED as T18 } from "./sections/18_mode_b.js";
import { TOOLS_TESTED as T19 } from "./sections/19_security.js";
import { TOOLS_TESTED as T20 } from "./sections/20_reconnect.js";
import { TOOLS_TESTED as T21 } from "./sections/21_user_scope.js";
import { TOOLS_TESTED as T22 } from "./sections/22_response_caps.js";
import { TOOLS_TESTED as T23 } from "./sections/23_extensibility.js";
import { TOOLS_TESTED as T24 } from "./sections/24_classdb.js";
import { TOOLS_TESTED as T25 } from "./sections/25_script_check.js";
import { TOOLS_TESTED as T26 } from "./sections/26_csharp_compat.js";
import { TOOLS_TESTED as T27 } from "./sections/27_theme.js";
import { TOOLS_TESTED as T28 } from "./sections/28_animationtree.js";
import { TOOLS_TESTED as T29 } from "./sections/29_layer_names.js";
import { TOOLS_TESTED as T30 } from "./sections/30_path2d.js";
import { TOOLS_TESTED as T31 } from "./sections/31_3d_tools.js";
import { TOOLS_TESTED as T32 } from "./sections/32_collision.js";
import { TOOLS_TESTED as T33 } from "./sections/33_procedural.js";
import { TOOLS_TESTED as T34 } from "./sections/34_scene_inheritance.js";
import { TOOLS_TESTED as T35 } from "./sections/35_audiobus.js";
import { TOOLS_TESTED as T36 } from "./sections/36_spriteframes.js";
import { TOOLS_TESTED as T37 } from "./sections/37_scene_query.js";
import { TOOLS_TESTED as T38 } from "./sections/38_particles.js";
import { TOOLS_TESTED as T39 } from "./sections/39_navigation.js";
import { TOOLS_TESTED as T40 } from "./sections/40_discover_tools.js";
import { TOOLS_TESTED as T41 } from "./sections/41_crash_detection.js";
import { TOOLS_TESTED as T42 } from "./sections/42_lsp.js";
import { TOOLS_TESTED as T43 } from "./sections/43_debugger.js";

// ── Unfiltered tool catalogue ───────────────────────────────────────

function getAllToolDefsUnfiltered(): ToolDef[] {
  const allArrays: ToolDef[][] = [
    sceneTools,
    nodeTools,
    scriptTools,
    editorTools,
    runtimeTools,
    signalTools,
    resourceTools,
    folderTools,
    diffTools,
    playtestTools,
    inputMapTools,
    animationTools,
    tilemapTools,
    assetTools,
    fileTools,
    saveTools,
    classdbTools,
    nodeManagementTools,
    themeTools,
    layerNameTools,
    pathTools,
    collisionTools,
    threeDTools,
    proceduralTools,
    sceneInheritanceTools,
    audioTools,
    spriteframesTools,
    sceneQueryTools,
    particleTools,
    navigationTools,
    lspTools,
    debugTools,
  ];
  const seen = new Set<string>();
  const result: ToolDef[] = [];
  for (const arr of allArrays) {
    for (const t of arr) {
      if (!seen.has(t.name)) {
        seen.add(t.name);
        result.push(t);
      }
    }
  }
  return result;
}

// ── Known domains (derived from existing tool methods) ──────────────
// Unknown domain = warning (not failure) to allow extension growth.
const KNOWN_DOMAINS = new Set([
  "3d",
  "animation",
  "animation_player",
  "animationtree",
  "asset",
  "audiobus",
  "autoload",
  "classdb",
  "debug",
  "debugger",
  "editor",
  "execute",
  "file",
  "folder",
  "game",
  "input",
  "input_map",
  "lsp",
  "navigation",
  "node",
  "particles",
  "path2d",
  "procedural",
  "project",
  "resource",
  "runtime",
  "save",
  "scene",
  "script",
  "signal",
  "spriteframes",
  "theme",
  "tilemap",
  "tileset",
]);

// ── Meta-tools registered programmatically (not in ToolDef arrays) ──
// discover_tools and extensions_refresh are registered in index.ts/groups.ts
// and validated separately by the catalogue count check in 01_catalogue.ts.
const META_TOOLS = new Set(["discover_tools", "extensions_refresh"]);

// ── Known coverage gaps (warn, not fail) ────────────────────────────
// Tools with no dedicated smoke test section. Tracked in SMOKE-COVERAGE-MANIFEST.md.
const KNOWN_UNCOVERED = new Set([
  "runtime_get_script_vars", // Mode B — called indirectly but no dedicated assertion
  "runtime_set_property", // Mode B — called indirectly but no dedicated assertion
  "animation_get_keys", // No dedicated test (manifest gap)
]);

// ── Known naming exceptions ─────────────────────────────────────────
// Tools whose name doesn't match method.replace(/\./g, "_") due to
// intentional historical naming decisions. Not worth a breaking rename.
const NAMING_EXCEPTIONS = new Set([
  "layer_names_set", // method: project.set_layer_names
  "layer_names_get", // method: project.get_layer_names
  "collision_from_texture", // method: node.collision_from_sprite
  "navigation_edit", // method: navigation.edit_polygon
]);

// ── Aggregate TOOLS_TESTED ──────────────────────────────────────────
const ALL_TOOLS_TESTED = new Set([
  ...T01,
  ...T02,
  ...T03,
  ...T04,
  ...T05,
  ...T06,
  ...T07,
  ...T08,
  ...T09,
  ...T10,
  ...T11,
  ...T12,
  ...T13,
  ...T14,
  ...T15,
  ...T16,
  ...T17,
  ...T18,
  ...T19,
  ...T20,
  ...T21,
  ...T22,
  ...T23,
  ...T24,
  ...T25,
  ...T26,
  ...T27,
  ...T28,
  ...T29,
  ...T30,
  ...T31,
  ...T32,
  ...T33,
  ...T34,
  ...T35,
  ...T36,
  ...T37,
  ...T38,
  ...T39,
  ...T40,
  ...T41,
  ...T42,
  ...T43,
]);

// ── Check 1: Schema integrity ───────────────────────────────────────

function checkSchemaIntegrity(tools: ToolDef[], pass: (msg: string) => void, fail: (msg: string) => void): void {
  let failures = 0;
  for (const t of tools) {
    try {
      const schema = z.toJSONSchema(z.object(t.inputSchema));
      const s = schema as Record<string, unknown>;
      if (s.type !== "object") {
        fail(`schema integrity: ${t.name} — converted schema type is "${s.type}", expected "object"`);
        failures++;
        continue;
      }
      const props = (s.properties ?? {}) as Record<string, unknown>;
      const required = (s.required ?? []) as string[];
      for (const req of required) {
        if (!(req in props)) {
          fail(`schema integrity: ${t.name} — required param "${req}" not in properties`);
          failures++;
        }
      }
    } catch (err) {
      fail(`schema integrity: ${t.name} — Zod→JSON Schema conversion failed: ${(err as Error).message}`);
      failures++;
    }
  }
  if (failures === 0) pass(`schema integrity: all ${tools.length} tools have valid inputSchema`);
}

// ── Check 2: Tool coverage ──────────────────────────────────────────

function checkToolCoverage(tools: ToolDef[], pass: (msg: string) => void, fail: (msg: string) => void): void {
  const uncovered: string[] = [];
  const knownGaps: string[] = [];
  for (const t of tools) {
    if (!ALL_TOOLS_TESTED.has(t.name)) {
      if (KNOWN_UNCOVERED.has(t.name)) {
        knownGaps.push(t.name);
      } else {
        uncovered.push(t.name);
      }
    }
  }
  if (uncovered.length > 0) {
    fail(`tool coverage: ${uncovered.length} unexpected uncovered tools: ${uncovered.join(", ")}`);
  }
  if (knownGaps.length > 0) {
    console.log(`[smoke] WARN  tool coverage: ${knownGaps.length} known gaps: ${knownGaps.join(", ")}`);
  }
  if (uncovered.length === 0) {
    const gapMsg = knownGaps.length > 0 ? ` (${knownGaps.length} known gaps)` : "";
    pass(`tool coverage: all ${tools.length} ToolDef tools covered${gapMsg}`);
  }
}

// ── Check 3: Annotation completeness ────────────────────────────────

function checkAnnotations(tools: ToolDef[], pass: (msg: string) => void, fail: (msg: string) => void): void {
  let failures = 0;
  let warnings = 0;

  for (const t of tools) {
    const ann = t.annotations;
    // readOnlyHint must be defined
    if (ann?.readOnlyHint === undefined) {
      fail(`annotations: ${t.name} — missing readOnlyHint`);
      failures++;
    }
    // destructiveHint must be defined for MUTATING_TOOLS members
    if (MUTATING_TOOLS.has(t.name) && ann?.destructiveHint === undefined) {
      fail(`annotations: ${t.name} — in MUTATING_TOOLS but missing destructiveHint`);
      failures++;
    }
    // idempotentHint — warn only
    if (ann?.idempotentHint === undefined) {
      warnings++;
    }
  }

  if (failures === 0) {
    const warnMsg = warnings > 0 ? ` (${warnings} missing idempotentHint — recommended)` : "";
    pass(`annotations: all ${tools.length} tools have required hints${warnMsg}`);
  }
}

// ── Check 4: Naming convention ──────────────────────────────────────

function checkNamingConvention(tools: ToolDef[], pass: (msg: string) => void, fail: (msg: string) => void): void {
  let failures = 0;
  const newDomains: string[] = [];

  for (const t of tools) {
    const dotIdx = t.method.indexOf(".");
    if (dotIdx === -1) {
      fail(`naming: ${t.name} — method "${t.method}" has no dot separator`);
      failures++;
      continue;
    }
    const domain = t.method.slice(0, dotIdx);
    const action = t.method.slice(dotIdx + 1);

    // Domain must be known (warn on unknown)
    if (!KNOWN_DOMAINS.has(domain)) {
      newDomains.push(`${t.name} (domain: ${domain})`);
    }

    // Action must be snake_case
    if (/[A-Z]/.test(action)) {
      fail(`naming: ${t.name} — action "${action}" contains uppercase (camelCase?)`);
      failures++;
    }
    if (action.includes("-")) {
      fail(`naming: ${t.name} — action "${action}" contains hyphens`);
      failures++;
    }
    if (action.startsWith("_") || action.endsWith("_")) {
      fail(`naming: ${t.name} — action "${action}" has leading/trailing underscore`);
      failures++;
    }

    // Name should match method with dots→underscores (known exceptions allowed)
    const expectedName = t.method.replace(/\./g, "_");
    if (t.name !== expectedName && !NAMING_EXCEPTIONS.has(t.name)) {
      fail(`naming: ${t.name} — name doesn't match method "${t.method}" (expected "${expectedName}")`);
      failures++;
    }
  }

  if (newDomains.length > 0) {
    console.log(`[smoke] WARN  naming: ${newDomains.length} unknown domains: ${newDomains.join(", ")}`);
  }
  if (failures === 0) pass(`naming: all ${tools.length} tools follow <domain>.<action> snake_case convention`);
}

// ── Entry point ─────────────────────────────────────────────────────

export function runStructuralChecks(ctx: { pass: (msg: string) => void; fail: (msg: string) => void }): void {
  const { pass, fail } = ctx;
  const tools = getAllToolDefsUnfiltered();
  console.log(`\n[smoke] Structural checks — ${tools.length} tools (unfiltered) + ${META_TOOLS.size} meta-tools\n`);

  checkSchemaIntegrity(tools, pass, fail);
  checkToolCoverage(tools, pass, fail);
  checkAnnotations(tools, pass, fail);
  checkNamingConvention(tools, pass, fail);
}
