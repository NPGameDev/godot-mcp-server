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
import { tilesetTools } from "../../src/tools/tileset.js";
import { classdbTools } from "../../src/tools/classdb.js";
import { nodeManagementTools } from "../../src/tools/node_management.js";
import type { ToolDef } from "../../src/types.js";

import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, deepEqual } from "../helpers.js";

export const TOOLS_TESTED: string[] = ["discover_tools"];

/**
 * Collect all ToolDef arrays into a single flat list.
 */
function getAllToolDefs(): ToolDef[] {
  return [
    ...sceneTools,
    ...nodeTools,
    ...scriptTools,
    ...editorTools,
    ...runtimeTools,
    ...signalTools,
    ...resourceTools,
    ...folderTools,
    ...diffTools,
    ...playtestTools,
    ...inputMapTools,
    ...animationTools,
    ...tilemapTools,
    ...tilesetTools,
    ...assetTools,
    ...fileTools,
    ...saveTools,
    ...classdbTools,
    ...nodeManagementTools,
  ];
}

/**
 * CI-mode catalogue validation — static checks only, no bridge required.
 * Validates tool count, description length constraints, readonly canary,
 * and version-gate metadata. Safe to run without a Godot editor.
 */
export function testCatalogueStatic(ctx: { pass: (msg: string) => void; fail: (msg: string) => void }): void {
  const { pass, fail } = ctx;

  // Tool count — 75 tools total (all always present, no feature gates).
  const expectedToolCount = 75;
  const allTools = getAllToolDefs();
  if (allTools.length !== expectedToolCount) fail(`tool count: expected ${expectedToolCount}, got ${allTools.length}`);
  else pass(`tool count == ${expectedToolCount}`);

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
  // Count tools with readOnlyHint=true in the catalogue.
  // 25 readonly tools (23 base + save_read + save_list).
  const expectedReadonly = 25;
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

export async function testCatalogue(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  // Echo round-trip (verifies bridge is alive).
  const echoPayload = { t: Date.now(), nonce: "smoke-01" };
  const echoResult = await bridge.call("echo", echoPayload, CALL_TIMEOUT);
  if (!deepEqual(echoResult, echoPayload))
    fail(`echo: expected ${JSON.stringify(echoPayload)} got ${JSON.stringify(echoResult)}`);
  else pass("echo round-trip");

  // Static catalogue checks (shared with CI mode).
  testCatalogueStatic(ctx);
}
