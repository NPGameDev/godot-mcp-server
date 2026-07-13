import { editorTools } from "../../src/tools/editor.js";
import { runtimeTools } from "../../src/tools/runtime.js";
import { ALL_TOOL_DEFS, ALL_TOOL_NAMES, META_TOOL_NAMES } from "../../src/registration/catalogue.js";
import { GROUP_TOOL_NAMES, RUNTIME_TOOLS, LSP_TOOLS } from "../../src/groups/groups.js";
import { reportGroupStatusByName } from "../../src/groups/groupActivation.js";
import { isVersionAtLeast } from "../../src/shared/version.js";
import type { ErrorCode, ToolDef } from "../../src/shared/types.js";

// The screenshot viewport-unavailable codes must remain members of the ErrorCode
// union — a compile-time assertion, so a rename in types.ts breaks the build here
// rather than silently drifting the cross-repo contract.
const SCREENSHOT_ERROR_CODES = [
  "EDITOR_VIEWPORT_UNAVAILABLE",
  "RUNTIME_WINDOW_MINIMIZED",
] as const satisfies readonly ErrorCode[];

import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, deepEqual } from "../helpers.js";

export const TOOLS_TESTED: string[] = ["discover_tools"];

/**
 * The canonical list of every tool definition the server ships.
 * Single-sourced from src/registration/catalogue.ts so this can never drift
 * from the runtime surface or the --tools-count CLI output.
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
  const expectedToolCount = 112;
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
    "runtime_set_property",
    "node_set_property",
    "scene_create_node",
    "scene_instantiate",
    "script_write",
    // Surgical edit documents the NOT_FOUND / NOT_UNIQUE / replace_all semantics
    // and the diagnostics contract — the recovery loop must be spelled out.
    "script_edit",
    "tilemap_set_cells",
    "editor_refresh",
    "input_map_event",
    // Audio-bus editing has many sub-actions — 218 chars is intentional.
    "audiobus_edit",
    // Byte-offset pagination guidance — the next_offset/
    // total_bytes/has_more paging protocol must be spelled out for the agent.
    "save_read",
    // Line-window pagination guidance — the next_start_line/
    // total_lines/has_more paging protocol must be spelled out (mirrors save_read).
    "script_read",
    // Long-form reads whose returned/total_<unit>/has_more paging note pushes the
    // description past 200 chars (mirrors save_read) — descWaiver granted.
    "asset_list",
    "asset_get_dependencies",
    "editor_get_console",
    "scene_spatial_map",
    // classdb tools document the shared paged envelope plus their per-section /
    // per-search limit param (default 200, clamped), pushing past 200 chars.
    "classdb_get_info",
    "classdb_search",
    // Cursor-less cell reads document the returned/total_cells/has_more envelope
    // plus the region/source_id narrowing guidance — past 200 chars.
    "tilemap_read_cells",
    // The post-game_stop retry note (the first call may return GAME_NOT_RUNNING until the
    // session registry settles) must be spelled out for the agent — pushes past 200.
    "debugger_get_log",
    // Offset pagination guidance — the offset/limit/returned/total_matches/has_more/next_offset
    // envelope plus the between-pages mutation caveat must be spelled out (mirrors save_read).
    "scene_query",
  ]);
  for (const t of allTools) {
    if (descWaivers.has(t.name)) continue;
    if (t.description.length >= 200) fail(`${t.name} description ${t.description.length} >= 200 chars`);
  }
  pass(`tool descriptions <200 chars (${descWaivers.size} waivers)`);

  // Readonly tool count canary — catches accidental annotation drift.
  // Count tools with readOnlyHint=true across the full canonical catalogue.
  // 39 readonly tools across the full canonical catalogue; update the canary
  // deliberately when a readonly tool is added or an annotation changes.
  const expectedReadonly = 39;
  const readonlyCount = allTools.filter((t: ToolDef) => t.annotations?.readOnlyHint === true).length;
  if (readonlyCount !== expectedReadonly) fail(`readonly count: expected ${expectedReadonly}, got ${readonlyCount}`);
  else pass(`readonly count == ${expectedReadonly} (readOnlyHint canary)`);

  // Version-gate structural check — scene_close has godotMinVersion.
  // Dynamic visibility (hidden on Godot < 4.5) is validated by unit tests
  // (registry filtering logic). Here we verify the
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

  // Screenshot force-foreground params — the opt-in levers must be advertised on
  // their tools' input schema so an agent can retry a viewport-unavailable
  // capture. Structural, so it runs headless / in smoke:ci.
  const editorShot = editorTools.find((t: ToolDef) => t.name === "editor_screenshot");
  if (editorShot && "force_foreground_editor" in editorShot.inputSchema)
    pass("editor_screenshot advertises force_foreground_editor");
  else
    fail(
      `editor_screenshot missing force_foreground_editor param: ${JSON.stringify(Object.keys(editorShot?.inputSchema ?? {}))}`,
    );

  const runtimeShot = runtimeTools.find((t: ToolDef) => t.name === "runtime_screenshot");
  if (runtimeShot && "force_foreground_game" in runtimeShot.inputSchema)
    pass("runtime_screenshot advertises force_foreground_game");
  else
    fail(
      `runtime_screenshot missing force_foreground_game param: ${JSON.stringify(Object.keys(runtimeShot?.inputSchema ?? {}))}`,
    );

  // image_response_mode disk/both must be advertised on both screenshot tools so
  // an agent can request the lean disk envelope; runtime_screenshot also gains
  // save_path (the disk destination). Structural, so it runs headless / in smoke:ci.
  if (editorShot && "image_response_mode" in editorShot.inputSchema)
    pass("editor_screenshot advertises image_response_mode");
  else
    fail(
      `editor_screenshot missing image_response_mode param: ${JSON.stringify(Object.keys(editorShot?.inputSchema ?? {}))}`,
    );

  if (runtimeShot && "image_response_mode" in runtimeShot.inputSchema)
    pass("runtime_screenshot advertises image_response_mode");
  else
    fail(
      `runtime_screenshot missing image_response_mode param: ${JSON.stringify(Object.keys(runtimeShot?.inputSchema ?? {}))}`,
    );

  if (runtimeShot && "save_path" in runtimeShot.inputSchema) pass("runtime_screenshot advertises save_path");
  else
    fail(`runtime_screenshot missing save_path param: ${JSON.stringify(Object.keys(runtimeShot?.inputSchema ?? {}))}`);

  // The two viewport-unavailable codes are wired into the ErrorCode union (the
  // `satisfies` above is the compile-time guard; this records it in the report).
  pass(`viewport-unavailable codes in ErrorCode union (${SCREENSHOT_ERROR_CODES.join(", ")})`);
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

  // Advertise == register: discover_tools' group summaries must not offer a
  // version-gated built-in the connected editor cannot serve.
  // scene_close (godotMinVersion 4.5) lives in the cleanup group — the browse
  // summary must include it iff the connected editor can serve it, exactly
  // mirroring the registration gate. This is the cross-version CI guard: the
  // behavioral matrix runs the full smoke suite on real 4.2–4.7 editors, so the
  // <4.5 rows assert the omission and the 4.5+ rows assert the offer.
  const godotVer = bridge.getGodotVersion();
  const canServeSceneClose = godotVer != null && isVersionAtLeast(godotVer, "4.5");
  const advertisesSceneClose = reportGroupStatusByName(bridge, "cleanup", false).tools.some(
    (t) => t.name === "scene_close",
  );
  const verLabel = godotVer ? `${godotVer[0]}.${godotVer[1]}` : "unknown";
  if (advertisesSceneClose === canServeSceneClose) {
    pass(`discover_tools version gate: cleanup ${canServeSceneClose ? "offers" : "omits"} scene_close (${verLabel})`);
  } else {
    fail(
      `discover_tools version gate: cleanup advertises scene_close=${advertisesSceneClose}, expected ${canServeSceneClose} (${verLabel})`,
    );
  }
}
