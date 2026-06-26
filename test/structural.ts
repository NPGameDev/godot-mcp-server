/**
 * Structural validation checks for the tool catalogue.
 * Runs in CI mode (no Godot required). Validates schema integrity,
 * test coverage, annotation completeness, and naming conventions
 * across the full tool catalogue.
 *
 * Grilling decision (2026-05-19): 4 checks, standalone module.
 * See Plan/ExecutionPlan/41l-sexies-bis-ci-static-smoke-expansion.md.
 */

import { z } from "zod";
import type { ToolDef } from "../src/types.js";
import { isAllowedInReadOnly, STANDARD_TOOLS } from "../src/profiles.js";
import { GROUP_TOOL_NAMES } from "../src/groups.js";
import { addStringCoercion } from "../src/schema_coercion.js";

// ── Canonical tool inventory (single source of truth) ───────────────
import { ALL_TOOL_DEFS } from "../src/catalogue.js";

// ── Import TOOLS_TESTED from all 46 sections ────────────────────────
import { TOOLS_TESTED as T01 } from "./sections/01_catalogue.js";
import { TOOLS_TESTED as T02 } from "./sections/02_scene_node_basics.js";
import { TOOLS_TESTED as T03 } from "./sections/03_script_ops.js";
import { TOOLS_TESTED as T04 } from "./sections/04_editor_and_scene_nav.js";
import { TOOLS_TESTED as T05 } from "./sections/05_signals_and_introspection.js";
import { TOOLS_TESTED as T06 } from "./sections/06_scene_diff.js";
import { TOOLS_TESTED as T07 } from "./sections/07_error_contract.js";
import { TOOLS_TESTED as T08 } from "./sections/08_scene_file_lifecycle.js";
import { TOOLS_TESTED as T09 } from "./sections/09_resource_folder_shader.js";
import { TOOLS_TESTED as T10 } from "./sections/10_playtest_and_composition.js";
import { TOOLS_TESTED as T11 } from "./sections/11_project_set_setting.js";
import { TOOLS_TESTED as T12 } from "./sections/12_input_map.js";
import { TOOLS_TESTED as T13 } from "./sections/13_animation_tilemap_screenshot.js";
import { TOOLS_TESTED as T14 } from "./sections/14_asset_discovery_and_console.js";
import { TOOLS_TESTED as T15 } from "./sections/15_asset_import.js";
import { TOOLS_TESTED as T16 } from "./sections/16_custom_class_and_file_ops.js";
import { TOOLS_TESTED as T17 } from "./sections/17_mode_b.js";
import { TOOLS_TESTED as T18 } from "./sections/18_security.js";
import { TOOLS_TESTED as T19 } from "./sections/19_reconnect.js";
import { TOOLS_TESTED as T20 } from "./sections/20_user_scope.js";
import { TOOLS_TESTED as T21 } from "./sections/21_response_caps.js";
import { TOOLS_TESTED as T22 } from "./sections/22_extensibility.js";
import { TOOLS_TESTED as T23 } from "./sections/23_classdb.js";
import { TOOLS_TESTED as T24 } from "./sections/24_script_check.js";
import { TOOLS_TESTED as T25 } from "./sections/25_csharp_compat.js";
import { TOOLS_TESTED as T26 } from "./sections/26_theme.js";
import { TOOLS_TESTED as T27 } from "./sections/27_animationtree.js";
import { TOOLS_TESTED as T28 } from "./sections/28_layer_names.js";
import { TOOLS_TESTED as T29 } from "./sections/29_path2d.js";
import { TOOLS_TESTED as T30 } from "./sections/30_3d_tools.js";
import { TOOLS_TESTED as T31 } from "./sections/31_collision.js";
import { TOOLS_TESTED as T32 } from "./sections/32_procedural.js";
import { TOOLS_TESTED as T33 } from "./sections/33_scene_inheritance.js";
import { TOOLS_TESTED as T34 } from "./sections/34_audiobus.js";
import { TOOLS_TESTED as T35 } from "./sections/35_spriteframes.js";
import { TOOLS_TESTED as T36 } from "./sections/36_scene_query.js";
import { TOOLS_TESTED as T37 } from "./sections/37_particles.js";
import { TOOLS_TESTED as T38 } from "./sections/38_navigation.js";
import { TOOLS_TESTED as T39 } from "./sections/39_discover_tools.js";
import { TOOLS_TESTED as T40 } from "./sections/40_crash_detection.js";
import { TOOLS_TESTED as T41 } from "./sections/41_lsp.js";
import { TOOLS_TESTED as T42 } from "./sections/42_debugger.js";
import { TOOLS_TESTED as T43 } from "./sections/43_control_layout.js";
import { TOOLS_TESTED as T44 } from "./sections/44_tileset.js";
import { TOOLS_TESTED as T45 } from "./sections/45_spatial.js";
import { TOOLS_TESTED as T46 } from "./sections/46_placeholders.js";
import { TOOLS_TESTED as T47 } from "./sections/47_batch_partial_failure.js";

// ── Unfiltered tool catalogue ───────────────────────────────────────

function getAllToolDefsUnfiltered(): ToolDef[] {
  // Single-sourced from src/catalogue.ts — no manual array list, no dedup
  // (ALL_TOOL_DEFS is already unique; 01_catalogue asserts no duplicate names).
  return ALL_TOOL_DEFS;
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
  "control",
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
  "sound",
  "spriteframes",
  "texture",
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
const KNOWN_UNCOVERED = new Set<string>([
  // All tools now have dedicated assertions. Keep the set for future gaps.
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
  ...T44,
  ...T45,
  ...T46,
  ...T47,
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
    // destructiveHint must be defined for mutating tools (readOnlyHint !== true)
    if (!isAllowedInReadOnly(ann) && ann?.destructiveHint === undefined) {
      fail(`annotations: ${t.name} — mutating tool missing destructiveHint`);
      failures++;
    }
    // readOnlyHint + destructiveHint is a contradiction
    if (ann?.readOnlyHint && ann?.destructiveHint) {
      fail(`annotations: ${t.name} — has both readOnlyHint and destructiveHint`);
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

// ── Check 5: successHint canary ────────────────────────────────────

function checkSuccessHints(tools: ToolDef[], pass: (msg: string) => void, fail: (msg: string) => void): void {
  const EXPECTED_HINT_COUNT = 43;
  const hinted = tools.filter((t) => typeof t.successHint === "string" && t.successHint.length > 0);
  if (hinted.length < EXPECTED_HINT_COUNT) {
    const missing = EXPECTED_HINT_COUNT - hinted.length;
    fail(`successHint: expected >= ${EXPECTED_HINT_COUNT}, got ${hinted.length} (${missing} removed?)`);
  } else {
    pass(`successHint: ${hinted.length} tools have response hints (canary >= ${EXPECTED_HINT_COUNT})`);
  }
}

// ── Check 6: Reachability (every catalogued tool is registered) ─────

function checkReachability(tools: ToolDef[], pass: (msg: string) => void, fail: (msg: string) => void): void {
  // A tool is reachable iff it is eager (in STANDARD_TOOLS) OR on-demand (in
  // some group → GROUP_TOOL_NAMES). ALL_TOOL_DEFS feeds --tools-count and these
  // static checks, but it is NOT the registration path (see the src/catalogue.ts
  // guardrail + src/index.ts buildModuleAllowed). A tool present in the catalogue
  // yet in neither set is counted but never appears in tools/list — silently
  // unreachable from any client. This guard closes that gap.
  // (Caught 41m-quinquies regression a738182: scene_spatial_map was added to
  // ALL_TOOL_DEFS but not to STANDARD_TOOLS.)
  const reachable = new Set<string>([...STANDARD_TOOLS, ...GROUP_TOOL_NAMES]);
  const orphans = tools.filter((t) => !reachable.has(t.name)).map((t) => t.name);
  if (orphans.length > 0) {
    fail(
      `reachability: ${orphans.length} catalogued tool(s) registered nowhere — ` +
        `not in STANDARD_TOOLS (eager) nor any group (on-demand): ${orphans.join(", ")}. ` +
        `Counted by --tools-count but never advertised in tools/list. ` +
        `Add each to STANDARD_TOOLS (profiles.ts) or a group (groups.ts).`,
    );
  } else {
    pass(`reachability: all ${tools.length} catalogued tools are eager or on-demand (none orphaned)`);
  }
}

// ── Check 7: Optional-param input/output parity ─────────────────────

/**
 * Catch the "coercion wrapper flips an optional param to required" bug class
 * (S:159978c). The live registration path wraps every Zod inputSchema with
 * addStringCoercion before handing it to the SDK, and the SDK emits the JSON
 * Schema with io:"input". A z.preprocess()/coerce wrapper is a ZodPipe whose
 * INPUT side does not inherit an inner `.optional()` — so an optional param can
 * silently become `required` in tools/list while looking fine under the default
 * io:"output" conversion (and under Check 1, which uses io:"output").
 *
 * Invariant (intent-free, no allowlist): for every tool, the required[] set
 * under io:"input" must be a SUBSET of the required[] set under io:"output" —
 * i.e. no param may become required ONLY on the input side. Both conversions run
 * on the SAME addStringCoercion-wrapped shape (the live registered schema), so a
 * benign `.default()`-without-`.optional()` param (optional-on-input,
 * required-on-output) does NOT trip it; only the wrapper-leak bug does.
 * (Caught debug.ts:38 `z.preprocess(fn, z.boolean().default(true).optional())`.)
 */
function requiredSet(shape: Record<string, z.ZodTypeAny>, io: "input" | "output"): Set<string> {
  const json = z.toJSONSchema(z.object(shape), { io }) as Record<string, unknown>;
  return new Set((json.required as string[] | undefined) ?? []);
}

function checkInputOptionality(tools: ToolDef[], pass: (msg: string) => void, fail: (msg: string) => void): void {
  let failures = 0;
  for (const t of tools) {
    if (!t.inputSchema || Object.keys(t.inputSchema).length === 0) continue;
    try {
      const wrapped = addStringCoercion(t.inputSchema);
      const reqIn = requiredSet(wrapped, "input");
      const reqOut = requiredSet(wrapped, "output");
      const inputOnly = [...reqIn].filter((p) => !reqOut.has(p));
      if (inputOnly.length > 0) {
        fail(
          `optionality: ${t.name} — param(s) required ONLY on the io:"input" side: ${inputOnly.join(", ")}. ` +
            `A coercion wrapper (preprocess/pipe) is dropping an inner .optional() in tools/list. ` +
            `Put .optional() OUTERMOST (e.g. coercedBoolean().optional(), or z.preprocess(fn, inner).optional()).`,
        );
        failures++;
      }
    } catch (err) {
      fail(`optionality: ${t.name} — io conversion failed: ${(err as Error).message}`);
      failures++;
    }
  }
  if (failures === 0) {
    pass(`optionality: all ${tools.length} tools keep optional params optional under io:"input" (no wrapper leak)`);
  }
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
  checkSuccessHints(tools, pass, fail);
  checkReachability(tools, pass, fail);
  checkInputOptionality(tools, pass, fail);
}
