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
import type { ToolDef } from "../../src/types.js";
import { isEnabled as featureEnabled } from "../../src/feature_gate.js";

import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, deepEqual } from "../helpers.js";

export async function testCatalogue(ctx: TestCtx): Promise<{ ncmGated: boolean }> {
  const { bridge, pass, fail } = ctx;

  // Echo round-trip (verifies bridge is alive).
  const echoPayload = { t: Date.now(), nonce: "smoke-01" };
  const echoResult = await bridge.call("echo", echoPayload, CALL_TIMEOUT);
  if (!deepEqual(echoResult, echoPayload)) fail(`echo: expected ${JSON.stringify(echoPayload)} got ${JSON.stringify(echoResult)}`);
  else pass("echo round-trip");

  // Tool count — 49 base; feature gates add more when env vars are set.
  // iter 19: game_eval (+1), node_call_method (+1), project_set_setting (+1),
  // input_map_write (+4) are gated. All off = 49; all on = 60.
  // iter 19c: read_user_scope (+4) adds save_read/write/delete/list.
  let expectedToolCount = 49;
  if (featureEnabled("game_eval")) expectedToolCount += 1;
  if (featureEnabled("node_call_method")) expectedToolCount += 1;
  if (featureEnabled("project_set_setting")) expectedToolCount += 1;
  if (featureEnabled("input_map_write")) expectedToolCount += 4;
  if (featureEnabled("read_user_scope")) expectedToolCount += 4;
  const allTools = [
    ...sceneTools, ...nodeTools, ...scriptTools, ...editorTools,
    ...runtimeTools, ...signalTools, ...resourceTools, ...folderTools,
    ...diffTools, ...playtestTools, ...inputMapTools, ...animationTools,
    ...tilemapTools, ...assetTools, ...fileTools, ...saveTools,
  ];
  if (allTools.length !== expectedToolCount) fail(`tool count: expected ${expectedToolCount}, got ${allTools.length}`);
  else pass(`tool count == ${expectedToolCount} (gates: game_eval=${featureEnabled("game_eval")}, node_call_method=${featureEnabled("node_call_method")}, project_set_setting=${featureEnabled("project_set_setting")}, input_map_write=${featureEnabled("input_map_write")}, read_user_scope=${featureEnabled("read_user_scope")})`);

  // --lite catalogue size. No gated tools are lite-tier, so count is stable.
  const liteTools = allTools.filter((t) => t.tier === "lite");
  if (liteTools.length !== 14) fail(`--lite catalogue: expected 14, got ${liteTools.length} (${liteTools.map((t) => t.name).join(", ")})`);
  else pass(`--lite catalogue == 14 (subset of full ${expectedToolCount})`);

  const allToolNames = new Set(allTools.map((t) => t.name));
  const liteOrphans = liteTools.filter((t) => !allToolNames.has(t.name));
  if (liteOrphans.length > 0) fail(`lite tools not in full catalogue: ${liteOrphans.map((t) => t.name).join(", ")}`);
  else pass(`all lite tools resolve to catalogue entries`);

  // Feature gate catalogue checks (iter 19).
  const gateChecks: [string, string, ToolDef[]][] = [
    ["game_eval", "game_eval", runtimeTools],
    ["node_call_method", "node_call_method", nodeTools],
    ["project_set_setting", "project_set_setting", editorTools],
    ["input_map_write", "input_map_add_action", inputMapTools],
    ["read_user_scope", "save_read", saveTools],
  ];
  for (const [feature, toolName, toolArray] of gateChecks) {
    const present = toolArray.some((t: ToolDef) => t.name === toolName);
    const enabled = featureEnabled(feature);
    if (enabled && !present) fail(`${toolName} expected in catalogue when ${feature} enabled`);
    else if (!enabled && present) fail(`${toolName} expected ABSENT from catalogue when ${feature} disabled`);
    else pass(`${feature} gate -> catalogue ${present ? "includes" : "omits"} ${toolName}`);
  }

  // Defence-in-depth: call a gated editor-side method directly.
  const gateProbe = await bridge.call("node.call_method", { node_path: ".", method_name: "get_name" }, CALL_TIMEOUT) as { code?: string; how_to_enable?: string; risk?: string; success?: boolean; result?: unknown };
  let ncmGated: boolean;
  if (gateProbe?.code === "FEATURE_DISABLED") {
    if (!gateProbe.how_to_enable?.includes("mcp/unsafe/allow_node_call_method")) {
      fail(`defence-in-depth: FEATURE_DISABLED missing how_to_enable path`);
    } else if (!gateProbe.risk) {
      fail(`defence-in-depth: FEATURE_DISABLED missing risk field`);
    } else {
      pass(`defence-in-depth: node.call_method -> FEATURE_DISABLED with risk + how_to_enable`);
    }
    ncmGated = true;
  } else if (gateProbe?.success === true) {
    pass(`defence-in-depth: node.call_method -> enabled on Godot side (gate open)`);
    ncmGated = false;
  } else {
    fail(`defence-in-depth: unexpected response ${JSON.stringify(gateProbe)}`);
    ncmGated = true;
  }

  // I2: tool description length.
  for (const t of allTools) {
    if (t.description.length >= 200) fail(`${t.name} description ${t.description.length} >= 200 chars`);
  }
  pass("tool descriptions <200 chars");

  return { ncmGated };
}
