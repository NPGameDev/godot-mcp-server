import { editorTools } from "../../src/tools/editor.js";
import { ALL_TOOL_DEFS, ALL_TOOL_NAMES, META_TOOL_NAMES } from "../../src/catalogue.js";
import { GROUP_TOOL_NAMES, RUNTIME_TOOLS, LSP_TOOLS } from "../../src/groups.js";
import type { ToolDef } from "../../src/types.js";

import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, deepEqual } from "../helpers.js";

export const TOOLS_TESTED: string[] = ["discover_tools"];

/**
 * The canonical list of every tool definition the server ships.
 * Single-sourced from src/catalogue.ts so this can never drift from the
 * runtime surface or the --tools-count CLI output.
 */
function getAllToolDefs(): ToolDef[] {
  return ALL_TOOL_DEFS;
}

/**
 * CI-mode catalogue validation — static checks only, no bridge required.
 * Validates tool count, description length constraints, readonly canary,
 * and version-gate metadata. Safe to run without a Godot editor.
 */
export function testCatalogueStatic(ctx: { pass: (msg: string) => void; fail: (msg: string) => void }): void {
  const { pass, fail } = ctx;

  // Tool count — the complete canonical catalogue (ALL_TOOL_DEFS). Bump this
  // when tools are added/removed; `godot-mcp-server --tools-count` prints the
  // live value.
  const expectedToolCount = 105;
  const allTools = getAllToolDefs();
  if (allTools.length !== expectedToolCount) fail(`tool count: expected ${expectedToolCount}, got ${allTools.length}`);
  else pass(`tool count == ${expectedToolCount}`);

  // No duplicate tool names (catches double-counting, e.g. re-adding the
  // unsplit tilesetTools alongside the split structural+edit pair).
  if (ALL_TOOL_NAMES.size !== allTools.length)
    fail(`duplicate tool names: ${allTools.length} defs but ${ALL_TOOL_NAMES.size} unique`);
  else pass(`no duplicate tool names (${ALL_TOOL_NAMES.size} unique)`);

  // Eager/on-demand partition — on-demand is a subset of the total.
  const onDemand = GROUP_TOOL_NAMES.size;
  if (onDemand >= expectedToolCount) fail(`on-demand ${onDemand} not < total ${expectedToolCount}`);
  else pass(`eager == ${expectedToolCount - onDemand}, on-demand == ${onDemand}`);

  // Completeness guard — every group/runtime/lsp tool name must resolve in the
  // canonical catalogue. Catches an array dropped from ALL_TOOL_DEFS or a group
  // naming a tool that no longer exists.
  const special: Array<[string, string]> = [
    ...[...GROUP_TOOL_NAMES].map((n): [string, string] => ["group", n]),
    ...[...RUNTIME_TOOLS].map((n): [string, string] => ["runtime", n]),
    ...[...LSP_TOOLS].map((n): [string, string] => ["lsp", n]),
  ];
  const missing = special.filter(([, n]) => !ALL_TOOL_NAMES.has(n));
  if (missing.length) fail(`catalogue missing ${missing.length}: ${missing.map(([k, n]) => `${n}(${k})`).join(", ")}`);
  else pass(`completeness: all ${special.length} group/runtime/lsp names in catalogue`);

  // Meta tools are registered outside the module arrays — they must NOT appear
  // in ALL_TOOL_DEFS, else they would be double-counted.
  const metaLeak = META_TOOL_NAMES.filter((n) => ALL_TOOL_NAMES.has(n));
  if (metaLeak.length) fail(`meta tools leaked into ALL_TOOL_DEFS: ${metaLeak.join(", ")}`);
  else pass(`meta tools (${META_TOOL_NAMES.length}) distinct from module tools`);

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
    // Surfaced when the catalogue expanded to all modules (vicies-novies);
    // audio-bus editing has many sub-actions — 218 chars is intentional.
    "audiobus_edit",
  ]);
  for (const t of allTools) {
    if (descWaivers.has(t.name)) continue;
    if (t.description.length >= 200) fail(`${t.name} description ${t.description.length} >= 200 chars`);
  }
  pass(`tool descriptions <200 chars (${descWaivers.size} waivers)`);

  // Readonly tool count canary — catches accidental annotation drift.
  // Count tools with readOnlyHint=true across the full canonical catalogue.
  // 35 readonly tools (recomputed over all 105 tools in vicies-novies; was 25
  // when the catalogue under-counted at 75).
  const expectedReadonly = 35;
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
