import { animationTools } from "../../src/tools/animation.js";
import { assetTools } from "../../src/tools/asset.js";
import { diffTools } from "../../src/tools/diff.js";
import { editorTools } from "../../src/tools/editor.js";
import { fileTools } from "../../src/tools/file.js";
import { folderTools } from "../../src/tools/folder.js";
import { saveTools } from "../../src/tools/save.js";
import { inputMapTools } from "../../src/tools/input_map.js";
import { nodeTools } from "../../src/tools/node.js";
import { playtestTools } from "../../src/tools/playtest.js";
import { resourceTools } from "../../src/tools/resource.js";
import { runtimeTools } from "../../src/tools/runtime.js";
import { sceneTools } from "../../src/tools/scene.js";
import { scriptTools } from "../../src/tools/script.js";
import { signalTools } from "../../src/tools/signals.js";
import { tilemapTools } from "../../src/tools/tilemap.js";
import { classdbTools } from "../../src/tools/classdb.js";
import { nodeManagementTools } from "../../src/tools/node_management.js";
import type { ToolDef } from "../../src/types.js";
import { isEnabled as featureEnabled } from "../../src/feature_gate.js";

import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, deepEqual } from "../helpers.js";

export const TOOLS_TESTED: string[] = ["discover_tools"];
export const isAffectedByGates = true;

/**
 * Collect all ToolDef arrays into a single flat list, filtering by gate
 * state to mirror registration-time behavior. Module-level gated tools
 * (with a `gate` field) are filtered individually; group-level gated
 * tools (input_map, save) are included/excluded as a block.
 */
function getAllToolDefs(): ToolDef[] {
  const gateFilter = (t: ToolDef) => !t.gate || featureEnabled(t.gate);
  return [
    ...sceneTools,
    ...nodeTools.filter(gateFilter),
    ...scriptTools,
    ...editorTools.filter(gateFilter),
    ...runtimeTools.filter(gateFilter),
    ...signalTools,
    ...resourceTools,
    ...folderTools,
    ...diffTools,
    ...playtestTools,
    ...inputMapTools,
    ...animationTools,
    ...tilemapTools,
    ...assetTools,
    ...fileTools,
    ...(featureEnabled("read_user_scope") ? saveTools : []),
    ...classdbTools,
    ...nodeManagementTools,
  ];
}

/**
 * CI-mode catalogue validation — static checks only, no bridge required.
 * Validates tool count, feature-gate catalogue membership, and description
 * length constraints. Safe to run without a Godot editor.
 */
export function testCatalogueStatic(ctx: { pass: (msg: string) => void; fail: (msg: string) => void }): void {
  const { pass, fail } = ctx;

  // Tool count — 60 base (62 in arrays minus 2 gated: execute_code, node_call_method).
  // getAllToolDefs applies gateFilter, so the base already excludes gated tools.
  // read_user_scope (+4) adds save_read/write/delete/list via conditional spread.
  // Window 1 merge: +signal_list +signal_manage +control_set_layout -classdb_get_info
  // -classdb_search -asset_list = net 0, but +tilemap_read_cells (lazy) + control_set_layout
  // (standard) = net +2 from 58.
  // All off = 60; all on = 66.
  let expectedToolCount = 60;
  if (featureEnabled("execute_code")) expectedToolCount += 1;
  if (featureEnabled("node_call_method")) expectedToolCount += 1;
  if (featureEnabled("read_user_scope")) expectedToolCount += 4;
  const allTools = getAllToolDefs();
  if (allTools.length !== expectedToolCount) fail(`tool count: expected ${expectedToolCount}, got ${allTools.length}`);
  else
    pass(
      `tool count == ${expectedToolCount} (gates: execute_code=${featureEnabled("execute_code")}, node_call_method=${featureEnabled("node_call_method")}, read_user_scope=${featureEnabled("read_user_scope")})`,
    );

  // Feature gate catalogue checks — verify gated tools are present/absent
  // based on gate state. Uses filtered allTools (mirrors registration logic).
  const gateChecks: [string, string][] = [
    ["execute_code", "execute_code"],
    ["node_call_method", "node_call_method"],
    ["read_user_scope", "save_read"],
  ];
  for (const [feature, toolName] of gateChecks) {
    const present = allTools.some((t: ToolDef) => t.name === toolName);
    const enabled = featureEnabled(feature);
    if (enabled && !present) fail(`${toolName} expected in catalogue when ${feature} enabled`);
    else if (!enabled && present) fail(`${toolName} expected ABSENT from catalogue when ${feature} disabled`);
    else pass(`${feature} gate -> catalogue ${present ? "includes" : "omits"} ${toolName}`);
  }

  // Tool description length (I2: <= 200 chars, with explicit waivers).
  const descWaivers = new Set([
    "discover_tools",
    "node_manage",
    "node_groups",
    "autoload_manage",
    "input_simulate",
    "execute_code",
    "editor_screenshot",
    "runtime_set_property",
    "node_set_property",
    "scene_create_node",
    "scene_instantiate",
    "script_write",
    "tilemap_set_cells",
    "editor_refresh",
    "input_map_event",
  ]);
  for (const t of allTools) {
    if (descWaivers.has(t.name)) continue;
    if (t.description.length >= 200) fail(`${t.name} description ${t.description.length} >= 200 chars`);
  }
  pass(`tool descriptions <200 chars (${descWaivers.size} waivers)`);

  // Readonly tool count canary — catches accidental annotation drift.
  // Count tools with readOnlyHint=true in the eagerly-registered catalogue.
  // Base (gates off): 23 readonly. With read_user_scope: +2 (save_read, save_list).
  let expectedReadonly = 23;
  if (featureEnabled("read_user_scope")) expectedReadonly += 2;
  const readonlyCount = allTools.filter((t: ToolDef) => t.annotations?.readOnlyHint === true).length;
  if (readonlyCount !== expectedReadonly) fail(`readonly count: expected ${expectedReadonly}, got ${readonlyCount}`);
  else pass(`readonly count == ${expectedReadonly} (readOnlyHint canary)`);

  // Version-gate structural check — scene_close has godotMinVersion.
  // Dynamic visibility (hidden on Godot < 4.5) is validated by unit tests
  // (registry filtering logic in undecies-quinquies). Here we verify the
  // metadata exists so version gating can function.
  const sceneClose = editorTools.find((t: ToolDef) => t.name === "scene_close");
  if (!sceneClose) {
    fail("version-gate: scene_close not found in editorTools");
  } else if (!(sceneClose as ToolDef & { godotMinVersion?: string }).godotMinVersion) {
    fail("version-gate: scene_close missing godotMinVersion field");
  } else {
    pass(
      `version-gate: scene_close has godotMinVersion=${(sceneClose as ToolDef & { godotMinVersion?: string }).godotMinVersion}`,
    );
  }
}

export async function testCatalogue(ctx: TestCtx): Promise<{ ncmGated: boolean }> {
  const { bridge, pass, fail } = ctx;

  // Echo round-trip (verifies bridge is alive).
  const echoPayload = { t: Date.now(), nonce: "smoke-01" };
  const echoResult = await bridge.call("echo", echoPayload, CALL_TIMEOUT);
  if (!deepEqual(echoResult, echoPayload))
    fail(`echo: expected ${JSON.stringify(echoPayload)} got ${JSON.stringify(echoResult)}`);
  else pass("echo round-trip");

  // Static catalogue checks (shared with CI mode).
  testCatalogueStatic(ctx);

  // ncmGated: derive from env var (defence-in-depth probing moved to section 02).
  const ncmGated = !featureEnabled("node_call_method");

  return { ncmGated };
}
