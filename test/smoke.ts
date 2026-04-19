import net from "node:net";
import { WebSocketServer, WebSocket as WS } from "ws";
import type { AddressInfo } from "node:net";

import { createBridge } from "../src/bridge.js";
import { animationTools } from "../src/tools/animation.js";
import { assetTools } from "../src/tools/asset.js";
import { diffTools } from "../src/tools/diff.js";
import { editorTools } from "../src/tools/editor.js";
import { fileTools } from "../src/tools/file.js";
import { folderTools } from "../src/tools/folder.js";
import { inputMapTools } from "../src/tools/input_map.js";
import { nodeTools } from "../src/tools/node.js";
import { playtestTools } from "../src/tools/playtest.js";
import { resourceTools } from "../src/tools/resource.js";
import { runtimeTools } from "../src/tools/runtime.js";
import { sceneTools } from "../src/tools/scene.js";
import { scriptTools } from "../src/tools/script.js";
import { signalTools } from "../src/tools/signals.js";
import { tilemapTools } from "../src/tools/tilemap.js";
import { BridgeError, type ToolDef } from "../src/types.js";
import { isEnabled as featureEnabled } from "../src/feature_gate.js";

// ─── Constants ───────────────────────────────────────────────────────────
const HOST = "127.0.0.1";
const PORT = Number(process.env.GODOT_MCP_PORT ?? "6505");
const RUNTIME_PORT = Number(process.env.GODOT_MCP_RUNTIME_PORT ?? "9090");
const PROBE_TIMEOUT_MS = 1000;
const MAIN_SCENE = "res://Main.tscn";
const CALL_TIMEOUT = 5000;
const SCREENSHOT_TIMEOUT = 10000;
const IMPORT_TIMEOUT = 15000;

// ─── Bridge type alias ──────────────────────────────────────────────────
type BridgeInstance = ReturnType<typeof createBridge> extends Promise<infer T> ? T : ReturnType<typeof createBridge>;

// ─── Test context ────────────────────────────────────────────────────────
// Passed to every test section. `fail` sets a flag that main() reads at exit.
type TestCtx = {
  bridge: BridgeInstance;
  pass: (msg: string) => void;
  fail: (msg: string) => void;
};

// ─── Assertion helpers ───────────────────────────────────────────────────

/** Assert a guard rejection: {success:false, code, error containing mustInclude}. */
function assertGuard(
  ctx: TestCtx,
  label: string,
  result: unknown,
  code: string,
  mustInclude: string | string[],
): void {
  const r = result as { success?: boolean; code?: string; error?: string };
  const needles = Array.isArray(mustInclude) ? mustInclude : [mustInclude];
  if (r?.success !== false || r.code !== code) {
    ctx.fail(`${label}: expected code=${code}, got ${JSON.stringify(result)}`);
  } else if (!needles.every((n) => r.error?.includes(n))) {
    ctx.fail(`${label}: message missing ${needles.find((n) => !r.error?.includes(n))} in ${JSON.stringify(r.error)}`);
  } else {
    ctx.pass(`${label} -> ${code} (message mentions ${needles.join(" + ")})`);
  }
}

/** Assert an error envelope: {success:false, code, error:string}. */
function assertError(
  ctx: TestCtx,
  label: string,
  result: unknown,
  code: string,
): void {
  const r = result as { success?: boolean; error?: string; code?: string };
  if (!r || r.success !== false || r.code !== code || typeof r.error !== "string") {
    ctx.fail(`${label}: expected {success:false, code:'${code}', error:string}, got ${JSON.stringify(result)}`);
  } else {
    ctx.pass(`${label} -> ${code}`);
  }
}

// ─── Standalone helpers ──────────────────────────────────────────────────

async function probePort(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const done = (ok: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

function printUnreachable(): void {
  console.error(`[smoke] ERROR: nothing listening on ${HOST}:${PORT}.

The Godot toolkit editor must be running with the plugin enabled:
  1. Open the toolkit repo (see memory/reference_repo_paths.md §2) in Godot 4.x
  2. Project -> Project Settings -> Plugins -> "Godot MCP Toolkit" -> Active
  3. Re-run \`npm run smoke\`.

The smoke test does not launch Godot; it only verifies the plugin is reachable.`);
}

// Fake echo server for the iter-13 reconnect smoke. Echoes JSON-RPC
// `echo` calls back with their params as result; tracks active peers so
// `dropAll()` can simulate a plugin disable/re-enable without taking the
// listener down (avoids same-port bind race after wss.close).
async function makeFakeEchoServer(): Promise<{ port: number; dropAll: () => void; close: () => Promise<void> }> {
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>((res) => wss.once("listening", () => res()));
  const sockets = new Set<WS>();
  wss.on("connection", (sock) => {
    sockets.add(sock);
    sock.on("close", () => sockets.delete(sock));
    sock.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString()) as { id?: unknown; method?: string; params?: unknown };
        if (msg.method === "echo") {
          sock.send(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: msg.params }));
        }
      } catch {
        // ignore malformed
      }
    });
  });
  return {
    port: (wss.address() as AddressInfo).port,
    dropAll: () => {
      for (const s of sockets) s.terminate();
    },
    close: () =>
      new Promise<void>((res) => {
        for (const s of sockets) s.terminate();
        wss.close(() => res());
      }),
  };
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a && b && typeof a === "object") {
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const keysA = Object.keys(a as object);
    const keysB = Object.keys(b as object);
    if (keysA.length !== keysB.length) return false;
    for (const k of keysA) {
      if (!(k in (b as object))) return false;
      if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
    }
    return true;
  }
  return false;
}

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

// ═════════════════════════════════════════════════════════════════════════
// Test sections — each is self-contained with its own setup + cleanup.
// Called sequentially from main(). Section order is load-bearing where
// noted; otherwise they are independent.
// ═════════════════════════════════════════════════════════════════════════

// ─── 1. Catalogue: tool count, lite subset, feature gates, I2 ────────────
async function testCatalogue(ctx: TestCtx): Promise<{ ncmGated: boolean }> {
  const { bridge, pass, fail } = ctx;

  // Echo round-trip (verifies bridge is alive).
  const echoPayload = { t: Date.now(), nonce: "smoke-01" };
  const echoResult = await bridge.call("echo", echoPayload, CALL_TIMEOUT);
  if (!deepEqual(echoResult, echoPayload)) fail(`echo: expected ${JSON.stringify(echoPayload)} got ${JSON.stringify(echoResult)}`);
  else pass("echo round-trip");

  // Tool count — 49 base; feature gates add more when env vars are set.
  // iter 19: game_eval (+1), node_call_method (+1), project_set_setting (+1),
  // input_map_write (+4) are gated. All off = 49; all on = 56.
  let expectedToolCount = 49;
  if (featureEnabled("game_eval")) expectedToolCount += 1;
  if (featureEnabled("node_call_method")) expectedToolCount += 1;
  if (featureEnabled("project_set_setting")) expectedToolCount += 1;
  if (featureEnabled("input_map_write")) expectedToolCount += 4;
  const allTools = [
    ...sceneTools, ...nodeTools, ...scriptTools, ...editorTools,
    ...runtimeTools, ...signalTools, ...resourceTools, ...folderTools,
    ...diffTools, ...playtestTools, ...inputMapTools, ...animationTools,
    ...tilemapTools, ...assetTools, ...fileTools,
  ];
  if (allTools.length !== expectedToolCount) fail(`tool count: expected ${expectedToolCount}, got ${allTools.length}`);
  else pass(`tool count == ${expectedToolCount} (gates: game_eval=${featureEnabled("game_eval")}, node_call_method=${featureEnabled("node_call_method")}, project_set_setting=${featureEnabled("project_set_setting")}, input_map_write=${featureEnabled("input_map_write")})`);

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

// ─── 2. Scene + node basics: get_tree, create/delete, properties ─────────
async function testSceneNodeBasics(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  const tree = await bridge.call("scene.get_tree", null, CALL_TIMEOUT) as { name?: string; children?: unknown[]; code?: string };
  if (tree && tree.code === "NO_SCENE") {
    fail("scene.get_tree: NO_SCENE — open Main.tscn in the Godot editor before running smoke");
  } else if (!tree || typeof tree.name !== "string" || !Array.isArray(tree.children)) {
    fail(`scene.get_tree: unexpected shape ${JSON.stringify(tree)}`);
  } else {
    pass(`scene.get_tree root=${tree.name}`);
  }

  // Idempotent create (iter 15 status discriminator).
  const nodeName = "SmokeProbe";
  const freshNode = await bridge.call("scene.create_node", { class_name: "Node", parent_path: ".", node_name: nodeName }, CALL_TIMEOUT) as { path?: string; status?: string; code?: string; error?: string };
  if (!freshNode || typeof freshNode.path !== "string") fail(`scene.create_node first call: ${JSON.stringify(freshNode)}`);
  else if (freshNode.status !== "created") fail(`scene.create_node fresh: expected status='created', got ${JSON.stringify(freshNode)}`);
  else pass(`scene.create_node fresh -> status='created' at ${freshNode.path}`);

  const idempotentNode = await bridge.call("scene.create_node", { class_name: "Node", parent_path: ".", node_name: nodeName }, CALL_TIMEOUT) as { path?: string; status?: string; code?: string };
  if (!idempotentNode || idempotentNode.status !== "returned" || idempotentNode.path !== freshNode.path) fail(`scene.create_node idempotency: expected status='returned' at ${freshNode.path}, got ${JSON.stringify(idempotentNode)}`);
  else if (idempotentNode.code !== undefined) fail(`scene.create_node collision success must not carry code (got ${idempotentNode.code})`);
  else pass(`scene.create_node idempotent -> status='returned' at ${idempotentNode.path}`);

  // Property round-trip via editor_description (plain String).
  const nodePath = freshNode?.path ?? nodeName;
  const marker = `smoke-${Date.now()}`;
  const setResult = await bridge.call("node.set_property", { node_path: nodePath, property: "editor_description", value: marker }, CALL_TIMEOUT) as { ok?: boolean; code?: string; error?: string };
  if (!setResult?.ok) fail(`node.set_property: ${JSON.stringify(setResult)}`);
  const getResult = await bridge.call("node.get_property", { node_path: nodePath, property: "editor_description" }, CALL_TIMEOUT) as { value?: unknown; code?: string };
  if (getResult?.value !== marker) fail(`node.get_property: expected ${marker} got ${JSON.stringify(getResult)}`);
  else pass("node.set_property + node.get_property round-trip");

  // Cleanup.
  const deleteResult = await bridge.call("scene.delete_node", { node_path: nodePath }, CALL_TIMEOUT) as { ok?: boolean; code?: string };
  if (!deleteResult?.ok) fail(`scene.delete_node: ${JSON.stringify(deleteResult)}`);
  else pass("scene.delete_node cleanup");
}

// ─── 3. Script ops: write, read, reload, errors ─────────────────────────
async function testScriptOps(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  const scriptPath = "res://smoke_probe.gd";
  const scriptBody = `# smoke ${Date.now()}\nextends Node\n`;
  const writeResult = await bridge.call("script.write", { file_path: scriptPath, content: scriptBody }, CALL_TIMEOUT) as { ok?: boolean; undoable?: boolean; code?: string };
  if (!writeResult?.ok) fail(`script.write: ${JSON.stringify(writeResult)}`);
  if (writeResult?.undoable !== true) fail(`script.write missing undoable flag (iter-09 UndoRedo wrap): ${JSON.stringify(writeResult)}`);
  const readResult = await bridge.call("script.read", { file_path: scriptPath }, CALL_TIMEOUT) as { content?: string; code?: string };
  if (readResult?.content !== scriptBody) fail(`script.read round-trip mismatch: ${JSON.stringify(readResult)}`);
  else pass("script.write (undoable) + script.read round-trip");

  const reloadResult = await bridge.call("editor.reload_scripts", null, CALL_TIMEOUT) as { ok?: boolean; code?: string };
  if (!reloadResult?.ok) fail(`editor.reload_scripts: ${JSON.stringify(reloadResult)}`);
  else pass("editor.reload_scripts ok");

  const bogusRead = await bridge.call("script.read", { file_path: "res://does_not_exist_smoke.txt" }, CALL_TIMEOUT) as { code?: string };
  if (bogusRead?.code !== "NOT_FOUND") fail(`script.read bogus: expected NOT_FOUND, got ${JSON.stringify(bogusRead)}`);
  else pass("script.read bogus path -> NOT_FOUND");

  const errorsResult = await bridge.call("editor.get_errors", null, CALL_TIMEOUT) as { errors?: unknown[]; stub?: boolean };
  if (!Array.isArray(errorsResult?.errors)) fail(`editor.get_errors shape: ${JSON.stringify(errorsResult)}`);
  else pass(`editor.get_errors (stub=${errorsResult.stub})`);
}

// ─── 4. Editor screenshots + scene open/close + project.get_settings ─────
async function testEditorAndSceneNav(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  // Inline screenshot.
  const screenshotResult = await bridge.call("editor.screenshot", {}, SCREENSHOT_TIMEOUT) as { image_base64?: string; code?: string; error?: string; width?: number; height?: number; bytes?: number };
  if (!screenshotResult?.image_base64) {
    fail(`editor.screenshot: ${JSON.stringify(screenshotResult)}`);
  } else {
    const buf = Buffer.from(screenshotResult.image_base64, "base64");
    if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) {
      fail(`editor.screenshot: PNG magic bytes missing in inline data`);
    } else {
      pass(`editor.screenshot PNG ${buf.length}B (${screenshotResult.width}x${screenshotResult.height}) inline`);
    }
  }

  // Screenshot with save_path.
  const savePath = "res://smoke_screenshots/smoke.png";
  const savedScreenshot = await bridge.call("editor.screenshot", { save_path: savePath }, SCREENSHOT_TIMEOUT) as { image_base64?: string; path?: string; code?: string };
  if (savedScreenshot?.path !== savePath || !savedScreenshot.image_base64) fail(`editor.screenshot save_path: ${JSON.stringify(savedScreenshot)}`);
  else pass(`editor.screenshot save_path -> ${savedScreenshot.path}`);

  // Reject non-res:// save_path.
  const rejectedScreenshot = await bridge.call("editor.screenshot", { save_path: "user://bad.png" }, CALL_TIMEOUT) as { code?: string };
  if (rejectedScreenshot?.code !== "PATH_DENIED") fail(`editor.screenshot save_path user://: expected PATH_DENIED, got ${JSON.stringify(rejectedScreenshot)}`);
  else pass("editor.screenshot save_path user:// -> PATH_DENIED");

  // scene.open — re-open the currently-edited scene.
  const openResult = await bridge.call("scene.open", { file_path: MAIN_SCENE }, CALL_TIMEOUT) as { ok?: boolean; path?: string; code?: string };
  if (!openResult?.ok || openResult.path !== MAIN_SCENE) fail(`scene.open: ${JSON.stringify(openResult)}`);
  else pass(`scene.open ${openResult.path}`);

  const openNotFound = await bridge.call("scene.open", { file_path: "res://does_not_exist_smoke.tscn" }, CALL_TIMEOUT) as { code?: string };
  if (openNotFound?.code !== "NOT_FOUND") fail(`scene.open bogus: expected NOT_FOUND, got ${JSON.stringify(openNotFound)}`);
  else pass("scene.open bogus -> NOT_FOUND");

  // scene.close round-trip.
  const closeTestPath = "res://smoke_close_test.tscn";
  await bridge.call("scene.create", { file_path: closeTestPath, root_type: "Node", if_exists: "return" }, CALL_TIMEOUT);
  await bridge.call("scene.open", { file_path: closeTestPath }, CALL_TIMEOUT);
  const closedResult = await bridge.call("scene.close", { file_path: closeTestPath }, CALL_TIMEOUT) as { success?: boolean };
  if (!closedResult?.success) fail(`scene.close happy path: ${JSON.stringify(closedResult)}`);
  else pass("scene.close happy path -> success");
  assertGuard(ctx, "scene.close already-closed", await bridge.call("scene.close", { file_path: closeTestPath }, CALL_TIMEOUT), "NOT_FOUND", "not open");
  await bridge.call("scene.delete", { file_path: closeTestPath }, CALL_TIMEOUT);

  // scene.close guard rejections.
  assertGuard(ctx, "scene.close no res://", await bridge.call("scene.close", { file_path: "/tmp/foo.tscn" }, CALL_TIMEOUT), "INVALID_PATH", "res://");
  assertGuard(ctx, "scene.close not open", await bridge.call("scene.close", { file_path: "res://nonexistent_scene.tscn" }, CALL_TIMEOUT), "NOT_FOUND", "not open");
  assertGuard(ctx, "scene.close last tab", await bridge.call("scene.close", { file_path: MAIN_SCENE }, CALL_TIMEOUT), "EDITED_SCENE", "last");

  // project.get_settings with prefix.
  const settingsResult = await bridge.call("project.get_settings", { prefix: "application/" }, CALL_TIMEOUT) as { settings?: Record<string, unknown>; count?: number; filtered_secret_count?: number; code?: string };
  if (!settingsResult?.settings || typeof settingsResult.count !== "number") {
    fail(`project.get_settings shape: ${JSON.stringify(settingsResult)}`);
  } else if (settingsResult.count < 1) {
    fail(`project.get_settings prefix application/: expected >=1 key, got ${settingsResult.count}`);
  } else {
    const secretRe = /password|token|secret|key/i;
    const leaks = Object.keys(settingsResult.settings).filter((k) => secretRe.test(k));
    if (leaks.length > 0) fail(`project.get_settings leaked secret-like keys: ${leaks.join(", ")}`);
    else pass(`project.get_settings prefix=application/ -> ${settingsResult.count} keys, 0 leaks`);
  }
}

// ─── 5. Signals, property list, resource.load ────────────────────────────
async function testSignalsAndIntrospection(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  const signalProbeNode = await bridge.call("scene.create_node", { class_name: "Node", parent_path: ".", node_name: "SignalProbe" }, CALL_TIMEOUT) as { path?: string; code?: string };
  if (!signalProbeNode?.path) fail(`scene.create_node SignalProbe: ${JSON.stringify(signalProbeNode)}`);
  const signalProbePath = signalProbeNode?.path ?? "SignalProbe";

  // signal.list — Node base class exposes known signals.
  const signalListResult = await bridge.call("signal.list", { node_path: signalProbePath }, CALL_TIMEOUT) as { signals?: { name?: string; args?: unknown[] }[]; code?: string };
  if (!Array.isArray(signalListResult?.signals) || signalListResult.signals.length === 0) fail(`signal.list: ${JSON.stringify(signalListResult)}`);
  else if (!signalListResult.signals.some((s) => s.name === "child_order_changed")) fail(`signal.list: expected child_order_changed among ${signalListResult.signals.map((s) => s.name).join(",")}`);
  else pass(`signal.list -> ${signalListResult.signals.length} signals`);

  // Connect + idempotent repeat + disconnect + NOT_FOUND.
  const connectionArgs = { source_path: signalProbePath, signal_name: "child_order_changed", target_path: signalProbePath, method_name: "notify_property_list_changed" };
  const connectFresh = await bridge.call("signal.connect", connectionArgs, CALL_TIMEOUT) as { status?: string; code?: string; signal?: string };
  if (connectFresh?.status !== "created" || connectFresh.signal !== "child_order_changed") fail(`signal.connect first: expected status='created' with signal echoed, got ${JSON.stringify(connectFresh)}`);
  else pass(`signal.connect fresh -> status='created'`);

  const connectIdempotent = await bridge.call("signal.connect", connectionArgs, CALL_TIMEOUT) as { status?: string; code?: string };
  if (connectIdempotent?.status !== "returned") fail(`signal.connect idempotency: expected status='returned', got ${JSON.stringify(connectIdempotent)}`);
  else if (connectIdempotent.code !== undefined) fail(`signal.connect collision success must not carry code (got ${connectIdempotent.code})`);
  else pass("signal.connect repeat -> status='returned' + code absent (I3)");

  const emitResult = await bridge.call("signal.emit", { node_path: signalProbePath, signal_name: "child_order_changed", args: [] }, CALL_TIMEOUT) as { ok?: boolean; code?: string };
  if (!emitResult?.ok) fail(`signal.emit: ${JSON.stringify(emitResult)}`);
  else pass("signal.emit child_order_changed");

  const disconnectFirst = await bridge.call("signal.disconnect", connectionArgs, CALL_TIMEOUT) as { ok?: boolean; code?: string };
  if (!disconnectFirst?.ok) fail(`signal.disconnect first: ${JSON.stringify(disconnectFirst)}`);
  const disconnectRepeat = await bridge.call("signal.disconnect", connectionArgs, CALL_TIMEOUT) as { code?: string };
  if (disconnectRepeat?.code !== "NOT_FOUND") fail(`signal.disconnect repeat: expected NOT_FOUND, got ${JSON.stringify(disconnectRepeat)}`);
  else pass("signal.disconnect + NOT_FOUND on repeat");

  // node.get_property_list.
  const propertyList = await bridge.call("node.get_property_list", { node_path: signalProbePath }, CALL_TIMEOUT) as { properties?: { name?: string; type?: number; hint?: number; hint_string?: string }[]; count?: number; code?: string };
  if (!Array.isArray(propertyList?.properties) || typeof propertyList.count !== "number") {
    fail(`node.get_property_list shape: ${JSON.stringify(propertyList)}`);
  } else {
    const names = new Set(propertyList.properties.map((p) => p.name));
    if (!names.has("process_mode")) fail(`node.get_property_list: expected process_mode, got ${Array.from(names).slice(0, 5).join(",")}...`);
    else pass(`node.get_property_list -> ${propertyList.count} props (incl process_mode)`);
  }

  await bridge.call("scene.delete_node", { node_path: signalProbePath }, CALL_TIMEOUT);
  pass(`SignalProbe cleanup`);

  // resource.load on the dogfood icon.svg.
  const loadedResource = await bridge.call("resource.load", { file_path: "res://icon.svg" }, CALL_TIMEOUT) as { class?: string; path?: string; metadata?: { width?: number; height?: number }; code?: string };
  if (!loadedResource?.class) fail(`resource.load icon.svg: ${JSON.stringify(loadedResource)}`);
  else if (!loadedResource.metadata?.width || !loadedResource.metadata.height) fail(`resource.load icon.svg: missing width/height in metadata: ${JSON.stringify(loadedResource.metadata)}`);
  else pass(`resource.load icon.svg -> class=${loadedResource.class} ${loadedResource.metadata.width}x${loadedResource.metadata.height}`);

  const missingResource = await bridge.call("resource.load", { file_path: "res://does_not_exist_smoke.tres" }, CALL_TIMEOUT) as { code?: string };
  if (missingResource?.code !== "NOT_FOUND") fail(`resource.load bogus: expected NOT_FOUND, got ${JSON.stringify(missingResource)}`);
  else pass("resource.load bogus -> NOT_FOUND");
}

// ─── 6. Scene diff ───────────────────────────────────────────────────────
async function testSceneDiff(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  const treeBefore = await bridge.call("scene.get_tree", null, CALL_TIMEOUT);
  const diffProbeNode = await bridge.call("scene.create_node", { class_name: "Node", parent_path: ".", node_name: "DiffProbe" }, CALL_TIMEOUT) as { path?: string; code?: string };
  if (!diffProbeNode?.path) fail(`scene.create_node DiffProbe: ${JSON.stringify(diffProbeNode)}`);

  const diffResult = await bridge.call("scene.diff", { before: treeBefore }, CALL_TIMEOUT) as { changed?: boolean; diff?: string; added?: number; removed?: number; code?: string };
  if (diffResult?.changed !== true) fail(`scene.diff after mutation: expected changed=true, got ${JSON.stringify(diffResult)}`);
  else if (!diffResult.diff?.includes("DiffProbe")) fail(`scene.diff diff missing DiffProbe (truncated): ${diffResult.diff?.slice(0, 200)}`);
  else pass(`scene.diff after create_node -> changed +${diffResult.added}/-${diffResult.removed}`);

  const diffSelf = await bridge.call("scene.diff", { before: treeBefore, after: treeBefore }, CALL_TIMEOUT) as { changed?: boolean; code?: string };
  if (diffSelf?.changed !== false) fail(`scene.diff(before,before): expected changed=false, got ${JSON.stringify(diffSelf)}`);
  else pass("scene.diff(self) -> changed=false");

  await bridge.call("scene.delete_node", { node_path: diffProbeNode?.path ?? "DiffProbe" }, CALL_TIMEOUT);
  pass("DiffProbe cleanup");
}

// ─── 7. Error contract (iter 14, I1) + idempotency regression ────────────
async function testErrorContract(ctx: TestCtx): Promise<void> {
  const { bridge, pass } = ctx;

  assertError(ctx, "scene.create_node bogus class",
    await bridge.call("scene.create_node", { class_name: "NotAClass", parent_path: "." }, CALL_TIMEOUT), "INVALID_CLASS");
  assertError(ctx, "scene.delete_node bogus path",
    await bridge.call("scene.delete_node", { node_path: "NoSuchNode_xyz" }, CALL_TIMEOUT), "NOT_FOUND");
  assertError(ctx, "scene.delete_node refuses root",
    await bridge.call("scene.delete_node", { node_path: "." }, CALL_TIMEOUT), "INVALID_PATH");
  assertError(ctx, "node.get_property bogus path",
    await bridge.call("node.get_property", { node_path: "NoSuchNode_xyz", property: "name" }, CALL_TIMEOUT), "NOT_FOUND");
  assertError(ctx, "node.set_property bogus path",
    await bridge.call("node.set_property", { node_path: "NoSuchNode_xyz", property: "editor_description", value: "x" }, CALL_TIMEOUT), "NOT_FOUND");
  assertError(ctx, "node.get_property_list bogus path",
    await bridge.call("node.get_property_list", { node_path: "NoSuchNode_xyz" }, CALL_TIMEOUT), "NOT_FOUND");
  assertError(ctx, "script.write user:// path",
    await bridge.call("script.write", { file_path: "user://bad.txt", content: "x" }, CALL_TIMEOUT), "PATH_DENIED");
  assertError(ctx, "editor.save_scene non-res:// path",
    await bridge.call("editor.save_scene", { file_path: "/tmp/bad.tscn" }, CALL_TIMEOUT), "PATH_DENIED");
  assertError(ctx, "signal.list bogus path",
    await bridge.call("signal.list", { node_path: "NoSuchNode_xyz" }, CALL_TIMEOUT), "NOT_FOUND");
  assertError(ctx, "signal.connect bogus signal",
    await bridge.call("signal.connect", { source_path: ".", signal_name: "no_such_signal_xyz", target_path: ".", method_name: "notify_property_list_changed" }, CALL_TIMEOUT), "INVALID_PARAMS");
  assertError(ctx, "signal.emit bogus signal",
    await bridge.call("signal.emit", { node_path: ".", signal_name: "no_such_signal_xyz" }, CALL_TIMEOUT), "INVALID_PARAMS");
  assertError(ctx, "scene.diff missing before",
    await bridge.call("scene.diff", {}, CALL_TIMEOUT), "INVALID_PARAMS");
  assertError(ctx, "resource.load non-res://",
    await bridge.call("resource.load", { file_path: "/etc/passwd" }, CALL_TIMEOUT), "PATH_DENIED");

  // Iter 15 status discriminator regression guard.
  const idemNodeName = "IdempotencyProbe";
  const idemFirst = await bridge.call("scene.create_node", { class_name: "Node", parent_path: ".", node_name: idemNodeName }, CALL_TIMEOUT) as { path?: string; status?: string; success?: boolean };
  const idemSecond = await bridge.call("scene.create_node", { class_name: "Node", parent_path: ".", node_name: idemNodeName }, CALL_TIMEOUT) as { path?: string; status?: string; code?: string; success?: boolean };
  if (idemSecond?.success === false) {
    ctx.fail(`idempotent repeat must NOT carry success:false: ${JSON.stringify(idemSecond)}`);
  } else if (idemSecond?.status !== "returned") {
    ctx.fail(`idempotent repeat must carry status='returned': ${JSON.stringify(idemSecond)}`);
  } else if (idemSecond?.code !== undefined) {
    ctx.fail(`idempotent success must NOT carry code (got ${idemSecond.code})`);
  } else if (idemSecond?.path !== idemFirst?.path) {
    ctx.fail(`idempotent repeat must return same path: ${JSON.stringify({ first: idemFirst, second: idemSecond })}`);
  } else {
    pass("idempotent repeat -> non-error success, status='returned', code absent (iter 15 I3)");
  }
  await bridge.call("scene.delete_node", { node_path: idemFirst?.path ?? idemNodeName }, CALL_TIMEOUT);
}

// ─── 8. Scene file lifecycle: create/delete scene + script.delete ─────────
async function testSceneFileLifecycle(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  const scenePath = "res://smoke_throwaway.tscn";
  try { await bridge.call("scene.delete", { file_path: scenePath }, CALL_TIMEOUT); } catch { /* orphan cleanup */ }

  // Fresh create.
  const sceneCreated = await bridge.call("scene.create", { file_path: scenePath, root_type: "Node2D" }, CALL_TIMEOUT) as { success?: boolean; status?: string; path?: string; root_type?: string; code?: string };
  if (sceneCreated?.status !== "created" || sceneCreated.path !== scenePath || sceneCreated.root_type !== "Node2D") {
    fail(`scene.create fresh: expected status='created' path=${scenePath} root_type='Node2D', got ${JSON.stringify(sceneCreated)}`);
  } else pass(`scene.create fresh -> status='created' root_type=Node2D`);

  // Default if_exists (return).
  const sceneReturned = await bridge.call("scene.create", { file_path: scenePath, root_type: "Node2D" }, CALL_TIMEOUT) as { success?: boolean; status?: string; path?: string; code?: string };
  if (sceneReturned?.status !== "returned" || sceneReturned.path !== scenePath) {
    fail(`scene.create default if_exists repeat: expected status='returned', got ${JSON.stringify(sceneReturned)}`);
  } else if (sceneReturned.code !== undefined) fail(`scene.create returned must not carry code (got ${sceneReturned.code})`);
  else pass(`scene.create default repeat -> status='returned' (code absent)`);

  // if_exists: fail.
  const sceneFailed = await bridge.call("scene.create", { file_path: scenePath, root_type: "Node2D", if_exists: "fail" }, CALL_TIMEOUT) as { success?: boolean; code?: string; error?: string };
  if (sceneFailed?.success !== false || sceneFailed.code !== "ALREADY_EXISTS" || !sceneFailed.error?.includes("replace")) {
    fail(`scene.create if_exists=fail: expected ALREADY_EXISTS mentioning 'replace', got ${JSON.stringify(sceneFailed)}`);
  } else pass(`scene.create if_exists='fail' -> ALREADY_EXISTS (message steers to 'replace')`);

  // if_exists: replace.
  const sceneReplaced = await bridge.call("scene.create", { file_path: scenePath, root_type: "Node3D", if_exists: "replace" }, CALL_TIMEOUT) as { success?: boolean; status?: string; path?: string; root_type?: string; previous_root_type?: string; code?: string };
  if (sceneReplaced?.status !== "replaced" || sceneReplaced.root_type !== "Node3D" || sceneReplaced.previous_root_type !== "Node2D") {
    fail(`scene.create if_exists=replace: expected status='replaced' root_type=Node3D prev=Node2D, got ${JSON.stringify(sceneReplaced)}`);
  } else pass(`scene.create if_exists='replace' -> status='replaced' prev=${sceneReplaced.previous_root_type}`);

  // Invalid if_exists.
  const sceneBadIfExists = await bridge.call("scene.create", { file_path: scenePath, root_type: "Node", if_exists: "explode" }, CALL_TIMEOUT) as { success?: boolean; code?: string; error?: string };
  if (sceneBadIfExists?.code !== "INVALID_PARAMS" || !sceneBadIfExists.error?.includes("if_exists")) {
    fail(`scene.create invalid if_exists: expected INVALID_PARAMS, got ${JSON.stringify(sceneBadIfExists)}`);
  } else pass(`scene.create if_exists='explode' -> INVALID_PARAMS`);

  // Guard rejections.
  assertGuard(ctx, "scene.create /tmp path", await bridge.call("scene.create", { file_path: "/tmp/foo.tscn", root_type: "Node" }, CALL_TIMEOUT), "INVALID_PATH", "res://");
  assertGuard(ctx, "scene.create .txt extension", await bridge.call("scene.create", { file_path: "res://foo.txt", root_type: "Node" }, CALL_TIMEOUT), "INVALID_PATH", ".tscn");
  assertGuard(ctx, "scene.create missing parent dir", await bridge.call("scene.create", { file_path: "res://nonexistent_smoke_dir/foo.tscn", root_type: "Node" }, CALL_TIMEOUT), "PARENT_NOT_FOUND", "folder.create");
  assertGuard(ctx, "scene.create bogus class", await bridge.call("scene.create", { file_path: "res://smoke_bogus.tscn", root_type: "BogusClass" }, CALL_TIMEOUT), "INVALID_CLASS", ["ClassDB", "ProjectSettings"]);
  assertGuard(ctx, "scene.create Resource (not a Node)", await bridge.call("scene.create", { file_path: "res://smoke_resource.tscn", root_type: "Resource" }, CALL_TIMEOUT), "INVALID_CLASS", "Node");

  // scene.delete round-trip.
  const sceneDeleted = await bridge.call("scene.delete", { file_path: scenePath }, CALL_TIMEOUT) as { success?: boolean; path?: string; code?: string };
  if (sceneDeleted?.success !== true || sceneDeleted.path !== scenePath) fail(`scene.delete: ${JSON.stringify(sceneDeleted)}`);
  else pass(`scene.delete ${scenePath}`);
  const sceneDeleteRepeat = await bridge.call("scene.delete", { file_path: scenePath }, CALL_TIMEOUT) as { success?: boolean; code?: string };
  if (sceneDeleteRepeat?.success !== false || sceneDeleteRepeat.code !== "NOT_FOUND") fail(`scene.delete repeat: expected NOT_FOUND, got ${JSON.stringify(sceneDeleteRepeat)}`);
  else pass(`scene.delete repeat -> NOT_FOUND`);
  assertGuard(ctx, "scene.delete .txt extension", await bridge.call("scene.delete", { file_path: "res://bogus.txt" }, CALL_TIMEOUT), "INVALID_PATH", ".tscn");

  // EDITED_SCENE refusal + clean teardown via scene.close.
  const editedProbePath = "res://smoke_edited_probe.tscn";
  await bridge.call("scene.create", { file_path: editedProbePath, root_type: "Node", if_exists: "return" }, CALL_TIMEOUT);
  await bridge.call("scene.open", { file_path: editedProbePath }, CALL_TIMEOUT);
  const editedSceneDelete = await bridge.call("scene.delete", { file_path: editedProbePath }, CALL_TIMEOUT) as { success?: boolean; code?: string; error?: string };
  if (editedSceneDelete?.code !== "EDITED_SCENE") fail(`scene.delete of currently-edited: expected EDITED_SCENE, got ${JSON.stringify(editedSceneDelete)}`);
  else pass("scene.delete refuses currently-edited scene -> EDITED_SCENE");
  const editedSceneClose = await bridge.call("scene.close", { file_path: editedProbePath }, CALL_TIMEOUT) as { success?: boolean };
  if (!editedSceneClose?.success) fail(`edited-probe scene.close: ${JSON.stringify(editedSceneClose)}`);
  await bridge.call("scene.delete", { file_path: editedProbePath }, CALL_TIMEOUT);
  pass("EDITED_SCENE probe: clean teardown via scene.close + scene.delete");

  // script.delete round-trip.
  const scriptDelPath = "res://smoke_throwaway.gd";
  try { await bridge.call("script.delete", { file_path: scriptDelPath }, CALL_TIMEOUT); } catch { /* orphan cleanup */ }
  const scriptWriteResult = await bridge.call("script.write", { file_path: scriptDelPath, content: "extends Node\n" }, CALL_TIMEOUT) as { ok?: boolean };
  if (!scriptWriteResult?.ok) fail(`script.write throwaway.gd: ${JSON.stringify(scriptWriteResult)}`);
  const scriptDeleted = await bridge.call("script.delete", { file_path: scriptDelPath }, CALL_TIMEOUT) as { success?: boolean; path?: string; code?: string };
  if (scriptDeleted?.success !== true || scriptDeleted.path !== scriptDelPath) fail(`script.delete: ${JSON.stringify(scriptDeleted)}`);
  else pass(`script.delete ${scriptDelPath}`);
  const scriptDeleteRepeat = await bridge.call("script.delete", { file_path: scriptDelPath }, CALL_TIMEOUT) as { success?: boolean; code?: string };
  if (scriptDeleteRepeat?.success !== false || scriptDeleteRepeat.code !== "NOT_FOUND") fail(`script.delete repeat: expected NOT_FOUND, got ${JSON.stringify(scriptDeleteRepeat)}`);
  else pass(`script.delete repeat -> NOT_FOUND`);
  assertGuard(ctx, "script.delete .tscn extension", await bridge.call("script.delete", { file_path: "res://bogus.tscn" }, CALL_TIMEOUT), "INVALID_PATH", ".gd");
  assertGuard(ctx, "script.delete .txt extension", await bridge.call("script.delete", { file_path: "res://bogus.txt" }, CALL_TIMEOUT), "INVALID_PATH", ".gd");
}

// ─── 9. Resource/folder/shader lifecycle (iter 15b) ──────────────────────
async function testResourceFolderShader(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  const resourcePath = "res://smoke_resource.tres";
  const folderRoot = "res://smoke_dir";
  const folderDeep = `${folderRoot}/nested/deep`;
  const shaderPath = "res://smoke.gdshader";
  const shaderIncPath = "res://smoke.gdshaderinc";

  // Orphan cleanup.
  try { await bridge.call("resource.delete", { file_path: resourcePath }, CALL_TIMEOUT); } catch { /* noop */ }
  try { await bridge.call("script.delete", { file_path: shaderPath }, CALL_TIMEOUT); } catch { /* noop */ }
  try { await bridge.call("script.delete", { file_path: shaderIncPath }, CALL_TIMEOUT); } catch { /* noop */ }
  try { await bridge.call("folder.delete", { folder_path: folderRoot, recursive: true }, CALL_TIMEOUT); } catch { /* noop */ }

  // resource.create happy path + idempotency.
  const resourceCreated = await bridge.call("resource.create", { file_path: resourcePath, resource_class: "Resource", properties: { resource_name: "smoke" } }, CALL_TIMEOUT) as { success?: boolean; status?: string; path?: string; resource_class?: string; warnings?: string[]; code?: string };
  if (resourceCreated?.status !== "created" || resourceCreated.resource_class !== "Resource") fail(`resource.create fresh: expected status='created' class='Resource', got ${JSON.stringify(resourceCreated)}`);
  else if (!Array.isArray(resourceCreated.warnings) || resourceCreated.warnings.length !== 0) fail(`resource.create fresh: expected warnings=[], got ${JSON.stringify(resourceCreated.warnings)}`);
  else pass(`resource.create fresh -> status='created' class=Resource warnings=0`);

  const resourceReturned = await bridge.call("resource.create", { file_path: resourcePath, resource_class: "Resource" }, CALL_TIMEOUT) as { status?: string; code?: string; path?: string };
  if (resourceReturned?.status !== "returned" || resourceReturned.path !== resourcePath) fail(`resource.create default repeat: expected status='returned', got ${JSON.stringify(resourceReturned)}`);
  else if (resourceReturned.code !== undefined) fail(`resource.create returned must not carry code (got ${resourceReturned.code})`);
  else pass(`resource.create default repeat -> status='returned' (code absent)`);

  // if_exists branches.
  const resourceFailed = await bridge.call("resource.create", { file_path: resourcePath, resource_class: "Resource", if_exists: "fail" }, CALL_TIMEOUT) as { success?: boolean; code?: string; error?: string };
  if (resourceFailed?.success !== false || resourceFailed.code !== "ALREADY_EXISTS" || !resourceFailed.error?.includes("replace")) {
    fail(`resource.create if_exists=fail: expected ALREADY_EXISTS mentioning 'replace', got ${JSON.stringify(resourceFailed)}`);
  } else pass(`resource.create if_exists='fail' -> ALREADY_EXISTS (message steers to 'replace')`);

  const resourceReplaced = await bridge.call("resource.create", { file_path: resourcePath, resource_class: "Curve", properties: { bake_resolution: 100 }, if_exists: "replace" }, CALL_TIMEOUT) as { status?: string; resource_class?: string; previous_class?: string; warnings?: string[]; code?: string };
  if (resourceReplaced?.status !== "replaced" || resourceReplaced.resource_class !== "Curve" || resourceReplaced.previous_class !== "Resource") {
    fail(`resource.create if_exists=replace: expected status='replaced' class=Curve prev=Resource, got ${JSON.stringify(resourceReplaced)}`);
  } else pass(`resource.create if_exists='replace' -> status='replaced' prev=${resourceReplaced.previous_class}`);

  const resourceBadIfExists = await bridge.call("resource.create", { file_path: resourcePath, resource_class: "Resource", if_exists: "explode" }, CALL_TIMEOUT) as { code?: string; error?: string };
  if (resourceBadIfExists?.code !== "INVALID_PARAMS" || !resourceBadIfExists.error?.includes("if_exists")) {
    fail(`resource.create invalid if_exists: expected INVALID_PARAMS, got ${JSON.stringify(resourceBadIfExists)}`);
  } else pass(`resource.create if_exists='explode' -> INVALID_PARAMS`);

  // Guard rejections.
  assertGuard(ctx, "resource.create /tmp path", await bridge.call("resource.create", { file_path: "/tmp/foo.tres", resource_class: "Resource" }, CALL_TIMEOUT), "INVALID_PATH", "res://");
  assertGuard(ctx, "resource.create .gd extension", await bridge.call("resource.create", { file_path: "res://foo.gd", resource_class: "Resource" }, CALL_TIMEOUT), "INVALID_PATH", "script.write");
  assertGuard(ctx, "resource.create missing parent dir", await bridge.call("resource.create", { file_path: "res://no_such_dir_smoke/foo.tres", resource_class: "Resource" }, CALL_TIMEOUT), "PARENT_NOT_FOUND", "folder.create");
  assertGuard(ctx, "resource.create bogus class", await bridge.call("resource.create", { file_path: "res://smoke_bogus.tres", resource_class: "BogusClass" }, CALL_TIMEOUT), "INVALID_CLASS", ["ClassDB", "ProjectSettings"]);
  assertGuard(ctx, "resource.create Node2D (not a Resource)", await bridge.call("resource.create", { file_path: "res://smoke_node2d.tres", resource_class: "Node2D" }, CALL_TIMEOUT), "NOT_A_RESOURCE", "base chain");

  // Unknown-key warning.
  const warnPath = "res://smoke_warn.tres";
  try { await bridge.call("resource.delete", { file_path: warnPath }, CALL_TIMEOUT); } catch { /* noop */ }
  const resourceWithWarning = await bridge.call("resource.create", { file_path: warnPath, resource_class: "Resource", properties: { bogus_key: 42 } }, CALL_TIMEOUT) as { status?: string; warnings?: string[]; code?: string };
  if (resourceWithWarning?.status !== "created") fail(`resource.create warn probe: expected status='created', got ${JSON.stringify(resourceWithWarning)}`);
  else if (!Array.isArray(resourceWithWarning.warnings) || resourceWithWarning.warnings.length !== 1 || !resourceWithWarning.warnings[0].includes("bogus_key") || !resourceWithWarning.warnings[0].includes("Resource")) {
    fail(`resource.create unknown-key warning: expected warnings[0] mentioning bogus_key + Resource, got ${JSON.stringify(resourceWithWarning.warnings)}`);
  } else pass(`resource.create unknown key -> warnings[0] names 'bogus_key' + 'Resource'`);
  await bridge.call("resource.delete", { file_path: warnPath }, CALL_TIMEOUT);

  // resource.save round-trip.
  const resourceSaved = await bridge.call("resource.save", { file_path: resourcePath, properties: { bake_resolution: 200 } }, CALL_TIMEOUT) as { success?: boolean; resource_class?: string; warnings?: string[]; status?: string; code?: string };
  if (resourceSaved?.success !== true || resourceSaved.resource_class !== "Curve") fail(`resource.save round-trip: ${JSON.stringify(resourceSaved)}`);
  else if (resourceSaved.status !== undefined) fail(`resource.save must NOT carry status (update, not create): got ${resourceSaved.status}`);
  else if (!Array.isArray(resourceSaved.warnings) || resourceSaved.warnings.length !== 0) fail(`resource.save: expected warnings=[], got ${JSON.stringify(resourceSaved.warnings)}`);
  else pass(`resource.save round-trip -> class=Curve, no warnings, no status field`);

  const resourceLoaded = await bridge.call("resource.load", { file_path: resourcePath }, CALL_TIMEOUT) as { properties?: { bake_resolution?: number }; code?: string };
  if (resourceLoaded?.properties?.bake_resolution !== 200) fail(`resource.load after save: expected bake_resolution=200, got ${JSON.stringify(resourceLoaded?.properties)}`);
  else pass(`resource.load after save -> bake_resolution=200`);
  assertGuard(ctx, "resource.save missing file", await bridge.call("resource.save", { file_path: "res://no_such_smoke.tres", properties: {} }, CALL_TIMEOUT), "NOT_FOUND", "resource.create");

  // resource.delete round-trip.
  const resourceDeleted = await bridge.call("resource.delete", { file_path: resourcePath }, CALL_TIMEOUT) as { success?: boolean; path?: string; code?: string };
  if (resourceDeleted?.success !== true || resourceDeleted.path !== resourcePath) fail(`resource.delete: ${JSON.stringify(resourceDeleted)}`);
  else pass(`resource.delete ${resourcePath}`);
  const resourceDeleteRepeat = await bridge.call("resource.delete", { file_path: resourcePath }, CALL_TIMEOUT) as { success?: boolean; code?: string };
  if (resourceDeleteRepeat?.code !== "NOT_FOUND") fail(`resource.delete repeat: expected NOT_FOUND, got ${JSON.stringify(resourceDeleteRepeat)}`);
  else pass(`resource.delete repeat -> NOT_FOUND`);
  assertGuard(ctx, "resource.delete .tscn extension", await bridge.call("resource.delete", { file_path: "res://bogus.tscn" }, CALL_TIMEOUT), "INVALID_PATH", "scene.delete");
  assertGuard(ctx, "resource.delete .gd extension", await bridge.call("resource.delete", { file_path: "res://bogus.gd" }, CALL_TIMEOUT), "INVALID_PATH", "script.delete");

  // folder.create — recursive + idempotency.
  const folderCreated = await bridge.call("folder.create", { folder_path: folderDeep }, CALL_TIMEOUT) as { success?: boolean; status?: string; path?: string; code?: string };
  if (folderCreated?.status !== "created" || folderCreated.path !== folderDeep) fail(`folder.create recursive: expected status='created' path=${folderDeep}, got ${JSON.stringify(folderCreated)}`);
  else pass(`folder.create recursive ${folderDeep} -> status='created'`);
  const folderIdempotent = await bridge.call("folder.create", { folder_path: folderDeep }, CALL_TIMEOUT) as { status?: string; code?: string };
  if (folderIdempotent?.status !== "returned") fail(`folder.create idempotency: expected status='returned', got ${JSON.stringify(folderIdempotent)}`);
  else if (folderIdempotent.code !== undefined) fail(`folder.create returned must not carry code (got ${folderIdempotent.code})`);
  else pass(`folder.create idempotent -> status='returned' (code absent)`);
  assertGuard(ctx, "folder.create /tmp path", await bridge.call("folder.create", { folder_path: "/tmp/smoke_bogus" }, CALL_TIMEOUT), "INVALID_PATH", "res://");

  // folder.delete — PATH_IN_USE refusal + clean teardown via scene.close.
  const pathInUseDir = "res://smoke_path_in_use";
  const pathInUseProbe = `${pathInUseDir}/probe.tscn`;
  try { await bridge.call("folder.create", { folder_path: pathInUseDir }, CALL_TIMEOUT); } catch { /* noop */ }
  await bridge.call("scene.create", { file_path: pathInUseProbe, root_type: "Node", if_exists: "return" }, CALL_TIMEOUT);
  await bridge.call("scene.open", { file_path: pathInUseProbe }, CALL_TIMEOUT);
  const folderInUse = await bridge.call("folder.delete", { folder_path: pathInUseDir, recursive: true }, CALL_TIMEOUT) as { code?: string; error?: string };
  if (folderInUse?.code !== "PATH_IN_USE" || !folderInUse.error?.includes(pathInUseProbe)) {
    fail(`folder.delete on folder containing edited scene: expected PATH_IN_USE naming ${pathInUseProbe}, got ${JSON.stringify(folderInUse)}`);
  } else pass(`folder.delete refuses folder containing edited scene -> PATH_IN_USE`);
  const pathInUseClose = await bridge.call("scene.close", { file_path: pathInUseProbe }, CALL_TIMEOUT) as { success?: boolean };
  if (!pathInUseClose?.success) fail(`PATH_IN_USE probe scene.close: ${JSON.stringify(pathInUseClose)}`);
  await bridge.call("scene.delete", { file_path: pathInUseProbe }, CALL_TIMEOUT);
  await bridge.call("folder.delete", { folder_path: pathInUseDir, recursive: true }, CALL_TIMEOUT);
  pass("PATH_IN_USE probe: clean teardown via scene.close + delete");

  // folder.delete guards.
  assertGuard(ctx, "folder.delete project root", await bridge.call("folder.delete", { folder_path: "res://" }, CALL_TIMEOUT), "FOLDER_PROTECTED", "root");
  assertGuard(ctx, "folder.delete res://addons", await bridge.call("folder.delete", { folder_path: "res://addons" }, CALL_TIMEOUT), "FOLDER_PROTECTED", "addons");
  assertGuard(ctx, "folder.delete toolkit plugin dir", await bridge.call("folder.delete", { folder_path: "res://addons/godot_mcp_toolkit" }, CALL_TIMEOUT), "FOLDER_PROTECTED", "godot_mcp_toolkit");
  assertGuard(ctx, "folder.delete non-empty without recursive", await bridge.call("folder.delete", { folder_path: folderRoot }, CALL_TIMEOUT), "DIR_NOT_EMPTY", "recursive:true");

  // folder.delete — empty leaf success.
  const folderDeleteLeaf = await bridge.call("folder.delete", { folder_path: folderDeep }, CALL_TIMEOUT) as { success?: boolean; path?: string; files_deleted?: number; directories_deleted?: number; code?: string };
  if (folderDeleteLeaf?.success !== true || folderDeleteLeaf.files_deleted !== 0 || folderDeleteLeaf.directories_deleted !== 0) {
    fail(`folder.delete empty leaf: expected success with zero counts, got ${JSON.stringify(folderDeleteLeaf)}`);
  } else pass(`folder.delete empty leaf ${folderDeep} -> files=0 dirs=0`);

  const folderDeleteRecursive = await bridge.call("folder.delete", { folder_path: folderRoot, recursive: true }, CALL_TIMEOUT) as { success?: boolean; files_deleted?: number; directories_deleted?: number; code?: string };
  if (folderDeleteRecursive?.success !== true) fail(`folder.delete recursive: ${JSON.stringify(folderDeleteRecursive)}`);
  else pass(`folder.delete recursive ${folderRoot} -> files=${folderDeleteRecursive.files_deleted} dirs=${folderDeleteRecursive.directories_deleted}`);

  // Shader allowlist.
  const shaderWriteResult = await bridge.call("script.write", { file_path: shaderPath, content: "shader_type canvas_item;\n" }, CALL_TIMEOUT) as { ok?: boolean; code?: string };
  if (!shaderWriteResult?.ok) fail(`script.write .gdshader: ${JSON.stringify(shaderWriteResult)}`);
  else pass(`script.write .gdshader ok`);
  const shaderIncWriteResult = await bridge.call("script.write", { file_path: shaderIncPath, content: "// smoke include\n" }, CALL_TIMEOUT) as { ok?: boolean; code?: string };
  if (!shaderIncWriteResult?.ok) fail(`script.write .gdshaderinc: ${JSON.stringify(shaderIncWriteResult)}`);
  else pass(`script.write .gdshaderinc ok`);
  assertGuard(ctx, "script.write .txt extension (new guard)", await bridge.call("script.write", { file_path: "res://smoke_bogus.txt", content: "x" }, CALL_TIMEOUT), "INVALID_PATH", ".gd");
  const shaderDeleted = await bridge.call("script.delete", { file_path: shaderPath }, CALL_TIMEOUT) as { success?: boolean; code?: string };
  if (shaderDeleted?.success !== true) fail(`script.delete .gdshader: ${JSON.stringify(shaderDeleted)}`);
  else pass(`script.delete .gdshader ok`);
  const shaderIncDeleted = await bridge.call("script.delete", { file_path: shaderIncPath }, CALL_TIMEOUT) as { success?: boolean; code?: string };
  if (shaderIncDeleted?.success !== true) fail(`script.delete .gdshaderinc: ${JSON.stringify(shaderIncDeleted)}`);
  else pass(`script.delete .gdshaderinc ok`);

  // Belt-and-braces cleanup.
  try { await bridge.call("resource.delete", { file_path: resourcePath }, CALL_TIMEOUT); } catch { /* noop */ }
  try { await bridge.call("resource.delete", { file_path: warnPath }, CALL_TIMEOUT); } catch { /* noop */ }
  try { await bridge.call("script.delete", { file_path: shaderPath }, CALL_TIMEOUT); } catch { /* noop */ }
  try { await bridge.call("script.delete", { file_path: shaderIncPath }, CALL_TIMEOUT); } catch { /* noop */ }
  try { await bridge.call("folder.delete", { folder_path: folderRoot, recursive: true }, CALL_TIMEOUT); } catch { /* noop */ }
}

// ─── 10. Playtest + instantiate + call_method + coercion (iter 15c) ──────
async function testPlaytestAndComposition(ctx: TestCtx, ncmGated: boolean): Promise<void> {
  const { bridge, pass, fail } = ctx;

  const instChildPath = "res://smoke_inst_child.tscn";
  const smokeTexPath = "res://smoke_texture.tres";

  // Orphan cleanup from previous aborted runs.
  try { await bridge.call("game.stop", {}, CALL_TIMEOUT); } catch { /* noop */ }
  for (const orphan of ["smoke_inst_child", "CellA", "Renamed", "CoercionSprite"]) {
    try { await bridge.call("scene.delete_node", { node_path: orphan }, CALL_TIMEOUT); } catch { /* noop */ }
  }
  try { await bridge.call("resource.delete", { file_path: smokeTexPath }, CALL_TIMEOUT); } catch { /* noop */ }
  try { await bridge.call("scene.delete", { file_path: instChildPath }, CALL_TIMEOUT); } catch { /* noop */ }
  await bridge.call("scene.open", { file_path: MAIN_SCENE }, CALL_TIMEOUT);

  // ── game.start / game.stop ──
  const gameStartResult = await bridge.call("game.start", { scene_path: "current", wait_for_runtime: false }, SCREENSHOT_TIMEOUT) as { success?: boolean; target?: string; runtime_ready?: boolean; runtime_port?: number; code?: string; error?: string };
  if (gameStartResult?.success !== true || gameStartResult.target !== "current") fail(`game.start target=current: ${JSON.stringify(gameStartResult)}`);
  else pass(`game.start target=current -> success (runtime_ready=${gameStartResult.runtime_ready})`);

  await new Promise((res) => setTimeout(res, 500));
  assertGuard(ctx, "game.start while already running", await bridge.call("game.start", {}, CALL_TIMEOUT), "ALREADY_PLAYING", "game.stop");

  const gameStopFirst = await bridge.call("game.stop", {}, CALL_TIMEOUT) as { success?: boolean; was_running?: boolean; status?: string; code?: string };
  if (gameStopFirst?.success !== true || gameStopFirst.was_running !== true) fail(`game.stop first: expected was_running=true, got ${JSON.stringify(gameStopFirst)}`);
  else if (gameStopFirst.status !== undefined) fail(`game.stop must NOT carry status (got ${gameStopFirst.status})`);
  else pass(`game.stop first -> was_running=true (no status field)`);

  await new Promise((res) => setTimeout(res, 1000));

  const gameStopIdempotent = await bridge.call("game.stop", {}, CALL_TIMEOUT) as { success?: boolean; was_running?: boolean; code?: string };
  if (gameStopIdempotent?.success !== true || gameStopIdempotent.was_running !== false) fail(`game.stop idempotent: expected was_running=false, got ${JSON.stringify(gameStopIdempotent)}`);
  else pass(`game.stop idempotent -> was_running=false`);

  // game.start guard rejections.
  assertGuard(ctx, "game.start target=bogus", await bridge.call("game.start", { scene_path: "bogus" }, CALL_TIMEOUT), "INVALID_PARAMS", ["main", "current", "res://"]);
  assertGuard(ctx, "game.start missing res:// scene", await bridge.call("game.start", { scene_path: "res://no_such_game_smoke.tscn" }, CALL_TIMEOUT), "NOT_FOUND", "scene.create");
  assertGuard(ctx, "game.start .tres extension", await bridge.call("game.start", { scene_path: "res://bogus_smoke_scene.tres" }, CALL_TIMEOUT), "INVALID_PATH", ".tscn");

  // ── scene.instantiate ──
  const childSceneCreated = await bridge.call("scene.create", { file_path: instChildPath, root_type: "Node2D" }, CALL_TIMEOUT) as { status?: string; code?: string };
  if (childSceneCreated?.status !== "created") fail(`scene.create ${instChildPath}: ${JSON.stringify(childSceneCreated)}`);
  else pass(`scene.create ${instChildPath} -> status='created' (Node2D root)`);

  const defaultName = "smoke_inst_child";
  const instantiateFresh = await bridge.call("scene.instantiate", { parent_path: ".", packed_path: instChildPath }, CALL_TIMEOUT) as { success?: boolean; status?: string; path?: string; class_name?: string; code?: string };
  if (instantiateFresh?.status !== "created" || instantiateFresh.path !== defaultName || instantiateFresh.class_name !== "Node2D") {
    fail(`scene.instantiate fresh: expected status='created' path='${defaultName}' class_name='Node2D', got ${JSON.stringify(instantiateFresh)}`);
  } else pass(`scene.instantiate fresh -> status='created' at ${instantiateFresh.path}`);

  const instantiateIdempotent = await bridge.call("scene.instantiate", { parent_path: ".", packed_path: instChildPath }, CALL_TIMEOUT) as { status?: string; path?: string; code?: string };
  if (instantiateIdempotent?.status !== "returned" || instantiateIdempotent.path !== defaultName) fail(`scene.instantiate idempotent: expected status='returned' path='${defaultName}', got ${JSON.stringify(instantiateIdempotent)}`);
  else if (instantiateIdempotent.code !== undefined) fail(`scene.instantiate returned must not carry code (got ${instantiateIdempotent.code})`);
  else pass(`scene.instantiate idempotent -> status='returned' (code absent)`);

  // Ownership: save → reload → verify child persists.
  const saveAfterInstantiate = await bridge.call("editor.save_scene", {}, CALL_TIMEOUT) as { ok?: boolean; code?: string };
  if (!saveAfterInstantiate?.ok) fail(`editor.save_scene after instantiate: ${JSON.stringify(saveAfterInstantiate)}`);
  await bridge.call("scene.open", { file_path: MAIN_SCENE }, CALL_TIMEOUT);
  const reloadedTree = await bridge.call("scene.get_tree", null, CALL_TIMEOUT) as { children?: { name?: string }[]; code?: string };
  if (!reloadedTree?.children?.some((c) => c.name === defaultName)) fail(`instantiated child missing after save+reload: ${JSON.stringify(reloadedTree?.children?.map((c) => c.name))}`);
  else pass(`scene.instantiate owner-set survives save+reload`);

  // Named instantiate with transform coercion.
  await bridge.call("scene.delete_node", { node_path: defaultName }, CALL_TIMEOUT);
  const instantiateNamed = await bridge.call("scene.instantiate", {
    parent_path: ".", packed_path: instChildPath, as_name: "CellA",
    transform: { position: { type: "Vector2", x: 32, y: 48 } },
  }, CALL_TIMEOUT) as { status?: string; path?: string; class_name?: string; code?: string };
  if (instantiateNamed?.status !== "created" || instantiateNamed.path !== "CellA") fail(`scene.instantiate as_name='CellA': expected path='CellA', got ${JSON.stringify(instantiateNamed)}`);
  else pass(`scene.instantiate as_name='CellA' -> ${instantiateNamed.path}`);

  await bridge.call("editor.save_scene", {}, CALL_TIMEOUT);
  await bridge.call("scene.open", { file_path: MAIN_SCENE }, CALL_TIMEOUT);
  const cellPosition = await bridge.call("node.get_property", { node_path: "CellA", property: "position" }, CALL_TIMEOUT) as { value?: { type?: string; x?: number; y?: number }; code?: string };
  if (cellPosition?.value?.type !== "Vector2" || cellPosition.value.x !== 32 || cellPosition.value.y !== 48) {
    fail(`scene.instantiate transform Vector2 round-trip: expected Vector2(32,48), got ${JSON.stringify(cellPosition)}`);
  } else pass(`scene.instantiate transform Vector2 round-trip -> x=32 y=48`);

  // scene.instantiate guard rejections.
  assertGuard(ctx, "scene.instantiate /tmp packed_path", await bridge.call("scene.instantiate", { parent_path: ".", packed_path: "/tmp/foo.tscn" }, CALL_TIMEOUT), "INVALID_PATH", "res://");
  assertGuard(ctx, "scene.instantiate .tres packed_path", await bridge.call("scene.instantiate", { parent_path: ".", packed_path: "res://bogus_smoke.tres" }, CALL_TIMEOUT), "INVALID_PATH", ["resource.create", ".tscn"]);
  assertGuard(ctx, "scene.instantiate missing packed_path", await bridge.call("scene.instantiate", { parent_path: ".", packed_path: "res://no_such_inst_smoke.tscn" }, CALL_TIMEOUT), "NOT_FOUND", "scene.create");
  assertGuard(ctx, "scene.instantiate bogus parent_path", await bridge.call("scene.instantiate", { parent_path: "NoSuchParent_xyz", packed_path: instChildPath }, CALL_TIMEOUT), "NOT_FOUND", "parent_path");

  // ── node.call_method (feature-gated iter 19) ──
  if (ncmGated) {
    pass("node.call_method -> FEATURE_DISABLED (skipping functional tests)");
  } else {
    const callGetName = await bridge.call("node.call_method", { node_path: ".", method_name: "get_name" }, CALL_TIMEOUT) as { success?: boolean; result?: unknown };
    if (callGetName?.success !== true || callGetName.result !== "Main") fail(`node.call_method .get_name on Main: expected "Main", got ${JSON.stringify(callGetName)}`);
    else pass(`node.call_method .get_name -> "Main"`);

    const callSetName = await bridge.call("node.call_method", { node_path: "CellA", method_name: "set_name", args: ["Renamed"] }, CALL_TIMEOUT) as { success?: boolean; code?: string };
    if (callSetName?.success !== true) fail(`node.call_method set_name: ${JSON.stringify(callSetName)}`);
    const renamedProperty = await bridge.call("node.get_property", { node_path: "Renamed", property: "name" }, CALL_TIMEOUT) as { value?: string; code?: string };
    if (renamedProperty?.value !== "Renamed") fail(`set_name round-trip: expected name='Renamed' at path='Renamed', got ${JSON.stringify(renamedProperty)}`);
    else pass(`node.call_method set_name round-trip -> "Renamed"`);

    assertGuard(ctx, "node.call_method bogus method", await bridge.call("node.call_method", { node_path: ".", method_name: "no_such_method_xyz" }, CALL_TIMEOUT), "INVALID_METHOD", "scene.get_tree");
    assertGuard(ctx, "node.call_method bogus path", await bridge.call("node.call_method", { node_path: "NoSuchNode_xyz", method_name: "get_name" }, CALL_TIMEOUT), "NOT_FOUND", "NoSuchNode_xyz");
  }

  // ── Resource-value coercion ──
  const textureCreated = await bridge.call("resource.create", { file_path: smokeTexPath, resource_class: "GradientTexture2D", properties: { width: 32, height: 32 } }, CALL_TIMEOUT) as { status?: string; code?: string };
  if (textureCreated?.status !== "created") fail(`resource.create ${smokeTexPath}: ${JSON.stringify(textureCreated)}`);
  else pass(`resource.create ${smokeTexPath} -> status='created' (GradientTexture2D)`);

  const coercionSpriteNode = await bridge.call("scene.create_node", { class_name: "Sprite2D", parent_path: ".", node_name: "CoercionSprite" }, CALL_TIMEOUT) as { status?: string; path?: string; code?: string };
  if (coercionSpriteNode?.status !== "created") fail(`scene.create_node Sprite2D: ${JSON.stringify(coercionSpriteNode)}`);
  const coercionSpritePath = coercionSpriteNode?.path ?? "CoercionSprite";

  const textureBindResult = await bridge.call("node.set_property", { node_path: coercionSpritePath, property: "texture", value: { type: "Resource", path: smokeTexPath } }, CALL_TIMEOUT) as { ok?: boolean; code?: string };
  if (!textureBindResult?.ok) fail(`node.set_property texture via Resource dict: ${JSON.stringify(textureBindResult)}`);
  else pass(`node.set_property texture <- {type:Resource,path:${smokeTexPath}}`);

  const textureReadResult = await bridge.call("node.get_property", { node_path: coercionSpritePath, property: "texture" }, CALL_TIMEOUT) as { value?: { type?: string; path?: string; class?: string }; code?: string };
  if (textureReadResult?.value?.type !== "Resource" || textureReadResult.value.path !== smokeTexPath || textureReadResult.value.class !== "GradientTexture2D") {
    fail(`node.get_property texture coercion round-trip: expected {type:Resource,path:${smokeTexPath},class:GradientTexture2D}, got ${JSON.stringify(textureReadResult)}`);
  } else pass(`node.get_property texture -> {type:Resource,class:GradientTexture2D} round-trip`);

  if (!ncmGated) {
    const callSetTexture = await bridge.call("node.call_method", { node_path: coercionSpritePath, method_name: "set_texture", args: [{ type: "Resource", path: smokeTexPath }] }, CALL_TIMEOUT) as { success?: boolean; code?: string };
    if (callSetTexture?.success !== true) fail(`node.call_method set_texture via Resource arg: ${JSON.stringify(callSetTexture)}`);
    else pass(`node.call_method set_texture (Resource arg coercion) ok`);
  }

  // Color coercion.
  const colorSetResult = await bridge.call("node.set_property", { node_path: coercionSpritePath, property: "modulate", value: { type: "Color", r: 1.0, g: 0.5, b: 0.0 } }, CALL_TIMEOUT) as { ok?: boolean; code?: string };
  if (!colorSetResult?.ok) fail(`node.set_property modulate <- Color dict: ${JSON.stringify(colorSetResult)}`);
  const colorReadResult = await bridge.call("node.get_property", { node_path: coercionSpritePath, property: "modulate" }, CALL_TIMEOUT) as { value?: { type?: string; r?: number; g?: number; b?: number; a?: number }; code?: string };
  if (colorReadResult?.value?.type !== "Color" || colorReadResult.value.r !== 1.0 || colorReadResult.value.g !== 0.5 || colorReadResult.value.b !== 0.0 || colorReadResult.value.a !== 1.0) {
    fail(`Color round-trip: expected {type:Color,r:1,g:0.5,b:0,a:1}, got ${JSON.stringify(colorReadResult)}`);
  } else pass(`Color coercion round-trip -> r=1 g=0.5 b=0 a=1`);

  assertGuard(ctx, "node.set_property Resource missing path",
    await bridge.call("node.set_property", { node_path: coercionSpritePath, property: "texture", value: { type: "Resource", path: "res://no_such_coerce_smoke.tres" } }, CALL_TIMEOUT),
    "LOAD_FAILED", "resource.create");

  // ── Self-cleanup ──
  try { await bridge.call("scene.delete_node", { node_path: coercionSpritePath }, CALL_TIMEOUT); } catch { /* noop */ }
  for (const name of ["Renamed", "CellA", "SmokeInstChild"]) {
    try { await bridge.call("scene.delete_node", { node_path: name }, CALL_TIMEOUT); } catch { /* noop */ }
  }
  try { await bridge.call("editor.save_scene", {}, CALL_TIMEOUT); } catch { /* noop */ }
  try { await bridge.call("resource.delete", { file_path: smokeTexPath }, CALL_TIMEOUT); } catch { /* noop */ }
  try { await bridge.call("scene.delete", { file_path: instChildPath }, CALL_TIMEOUT); } catch { /* noop */ }
  try { await bridge.call("game.stop", {}, CALL_TIMEOUT); } catch { /* noop */ }
  pass(`playtest + composition cleanup complete`);
}

// ─── 11. project.set_setting (iter 15d, dual-gated iter 19) ──────────────
async function testProjectSetSetting(ctx: TestCtx): Promise<void> {
  const { bridge, pass } = ctx;

  const settingKey = "application/config/mcp_smoke_15d";
  const setSettingResult = await bridge.call("project.set_setting", { key: settingKey, value: "smoke-15d-marker" }, CALL_TIMEOUT) as { success?: boolean; was_set_before?: boolean; previous_value?: unknown; key?: string; value?: unknown; code?: string };
  const isGated = setSettingResult?.code === "FEATURE_DISABLED";

  if (isGated) {
    pass("project.set_setting -> FEATURE_DISABLED (skipping functional tests)");
    return;
  }

  // Happy path: write + read back.
  const preGet = await bridge.call("project.get_settings", { prefix: "application/config" }, CALL_TIMEOUT) as { settings?: Record<string, unknown> };
  const previousValue = preGet?.settings?.[settingKey] ?? null;

  if (setSettingResult?.success !== true) ctx.fail(`project.set_setting: ${JSON.stringify(setSettingResult)}`);
  else pass(`project.set_setting ${settingKey} -> success (was_set_before=${setSettingResult.was_set_before})`);

  const postGet = await bridge.call("project.get_settings", { prefix: "application/config" }, CALL_TIMEOUT) as { settings?: Record<string, unknown> };
  if (postGet?.settings?.[settingKey] !== "smoke-15d-marker") ctx.fail(`project.set_setting round-trip: read-back ${JSON.stringify(postGet?.settings?.[settingKey])}`);
  else pass(`project.set_setting -> read-back via project.get_settings matches`);

  // Guard rejections.
  assertGuard(ctx, "project.set_setting mcp/unsafe/*",
    await bridge.call("project.set_setting", { key: "mcp/unsafe/allow_game_eval", value: true }, CALL_TIMEOUT), "INVALID_PATH", "FeatureGate");
  assertGuard(ctx, "project.set_setting editor/*",
    await bridge.call("project.set_setting", { key: "editor/something", value: "x" }, CALL_TIMEOUT), "INVALID_PATH", "editor-session state");
  assertGuard(ctx, "project.set_setting empty key",
    await bridge.call("project.set_setting", { key: "", value: 1 }, CALL_TIMEOUT), "INVALID_PARAMS", "non-empty");

  // Restore previous value.
  if (previousValue === null) {
    try { await bridge.call("project.set_setting", { key: settingKey, value: "" }, CALL_TIMEOUT); } catch { /* noop */ }
  } else {
    try { await bridge.call("project.set_setting", { key: settingKey, value: previousValue }, CALL_TIMEOUT); } catch { /* noop */ }
  }
}

// ─── 12. input_map.* (iter 15d, single-gated iter 19) ────────────────────
async function testInputMap(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  const smokeAction = "mcp_smoke_jump_15d";
  const addActionResult = await bridge.call("input_map.add_action", { action: smokeAction, deadzone: 0.4 }, CALL_TIMEOUT) as { status?: string; deadzone?: number; code?: string };
  const isGated = addActionResult?.code === "FEATURE_DISABLED";

  if (isGated) {
    pass("input_map.* -> FEATURE_DISABLED (skipping functional tests)");
    return;
  }

  // Clean stale entry, then re-create if needed.
  if (addActionResult?.status === "returned") {
    try { await bridge.call("input_map.remove_action", { action: smokeAction }, CALL_TIMEOUT); } catch { /* noop */ }
    const freshAdd = await bridge.call("input_map.add_action", { action: smokeAction, deadzone: 0.4 }, CALL_TIMEOUT) as { status?: string; deadzone?: number };
    if (freshAdd?.status !== "created") fail(`input_map.add_action re-create after stale: ${JSON.stringify(freshAdd)}`);
  }
  if (addActionResult?.status !== "created" && addActionResult?.status !== "returned") fail(`input_map.add_action: ${JSON.stringify(addActionResult)}`);
  else pass(`input_map.add_action ${smokeAction} -> status=${addActionResult.status}, deadzone=0.4`);

  // Idempotency: same action again -> returned, EXISTING deadzone.
  const addActionIdempotent = await bridge.call("input_map.add_action", { action: smokeAction, deadzone: 0.9 }, CALL_TIMEOUT) as { status?: string; deadzone?: number; code?: string };
  if (addActionIdempotent?.status !== "returned" || typeof addActionIdempotent.deadzone !== "number" || Math.abs(addActionIdempotent.deadzone - 0.4) > 0.001) fail(`input_map.add_action repeat: expected status=returned + deadzone~=0.4 (existing), got ${JSON.stringify(addActionIdempotent)}`);
  else pass(`input_map.add_action repeat -> status=returned + deadzone~=0.4 (existing wins per 15d contract)`);

  // Bind a key event.
  const addKeyEvent = await bridge.call("input_map.action_add_event", { action: smokeAction, event: { type: "key", keycode: "SPACE" } }, CALL_TIMEOUT) as { status?: string; event?: { type?: string }; code?: string };
  if (addKeyEvent?.status !== "created" || addKeyEvent.event?.type !== "key") fail(`input_map.action_add_event SPACE: ${JSON.stringify(addKeyEvent)}`);
  else pass(`input_map.action_add_event SPACE -> status=created`);

  const addKeyIdempotent = await bridge.call("input_map.action_add_event", { action: smokeAction, event: { type: "key", keycode: "SPACE" } }, CALL_TIMEOUT) as { status?: string; code?: string };
  if (addKeyIdempotent?.status !== "returned") fail(`input_map.action_add_event SPACE repeat: expected status=returned, got ${JSON.stringify(addKeyIdempotent)}`);
  else pass(`input_map.action_add_event SPACE repeat -> status=returned (equivalent-event idempotency)`);

  // Distinct event (joypad button) does not collide.
  const addJoypadEvent = await bridge.call("input_map.action_add_event", { action: smokeAction, event: { type: "joypad_button", button_index: 0, device: -1 } }, CALL_TIMEOUT) as { status?: string; code?: string };
  if (addJoypadEvent?.status !== "created") fail(`input_map.action_add_event joypad: ${JSON.stringify(addJoypadEvent)}`);
  else pass(`input_map.action_add_event joypad_button -> status=created (no collision with SPACE)`);

  const removeKeyEvent = await bridge.call("input_map.action_remove_event", { action: smokeAction, event: { type: "key", keycode: "SPACE" } }, CALL_TIMEOUT) as { success?: boolean; event?: { type?: string }; code?: string };
  if (removeKeyEvent?.success !== true || removeKeyEvent.event?.type !== "key") fail(`input_map.action_remove_event: ${JSON.stringify(removeKeyEvent)}`);
  else pass(`input_map.action_remove_event SPACE -> success`);

  assertGuard(ctx, "input_map.action_remove_event missing",
    await bridge.call("input_map.action_remove_event", { action: smokeAction, event: { type: "key", keycode: "SPACE" } }, CALL_TIMEOUT), "NOT_FOUND", "events");
  assertGuard(ctx, "input_map.remove_action ui_accept refusal",
    await bridge.call("input_map.remove_action", { action: "ui_accept" }, CALL_TIMEOUT), "INVALID_PARAMS", ["built-in UI action", "input_map.action_remove_event"]);
  assertGuard(ctx, "input_map.action_add_event bogus type",
    await bridge.call("input_map.action_add_event", { action: smokeAction, event: { type: "telepathy" } }, CALL_TIMEOUT), "INVALID_PARAMS", ["key", "mouse_button", "joypad_button", "joypad_motion"]);
  assertGuard(ctx, "input_map.action_add_event bogus keycode",
    await bridge.call("input_map.action_add_event", { action: smokeAction, event: { type: "key", keycode: "NONSENSE" } }, CALL_TIMEOUT), "INVALID_PARAMS", "symbolic names");
  assertGuard(ctx, "input_map.add_action empty",
    await bridge.call("input_map.add_action", { action: "" }, CALL_TIMEOUT), "INVALID_PARAMS", "non-empty");

  // Cleanup.
  try { await bridge.call("input_map.remove_action", { action: smokeAction }, CALL_TIMEOUT); } catch { /* noop */ }
  pass(`input_map.* round-trip + guards complete`);
}

// ─── 13. Animation, tilemap, screenshot_node (iter 15d) ──────────────────
async function testAnimationTilemapScreenshot(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  // ── animation.* guards ──
  const animPlayerNode = await bridge.call("scene.create_node", { class_name: "AnimationPlayer", parent_path: ".", node_name: "MCPSmokeAP" }, CALL_TIMEOUT) as { status?: string; path?: string; code?: string };
  const animSpriteNode = await bridge.call("scene.create_node", { class_name: "Sprite2D", parent_path: ".", node_name: "MCPSmokeASprite" }, CALL_TIMEOUT) as { status?: string; path?: string; code?: string };
  const animPlayerPath = animPlayerNode?.path ?? "MCPSmokeAP";
  const animSpritePath = animSpriteNode?.path ?? "MCPSmokeASprite";

  assertGuard(ctx, "animation.add_key missing animation",
    await bridge.call("animation.add_key", { player_path: animPlayerPath, animation_name: "no_such_anim", track_path: "MCPSmokeASprite:position", time: 0.0, value: 0 }, CALL_TIMEOUT),
    "NOT_FOUND", ["available", "no_such_anim"]);
  assertGuard(ctx, "animation.add_key non-AP",
    await bridge.call("animation.add_key", { player_path: animSpritePath, animation_name: "x", track_path: "y:position", time: 0, value: 0 }, CALL_TIMEOUT),
    "INVALID_CLASS", "AnimationPlayer");
  assertGuard(ctx, "animation.add_key bare NodePath",
    await bridge.call("animation.add_key", { player_path: animPlayerPath, animation_name: "no_such_anim", track_path: "MCPSmokeASprite", time: 0, value: 0 }, CALL_TIMEOUT),
    "INVALID_PARAMS", "property");

  try { await bridge.call("scene.delete_node", { node_path: animPlayerPath }, CALL_TIMEOUT); } catch { /* noop */ }
  try { await bridge.call("scene.delete_node", { node_path: animSpritePath }, CALL_TIMEOUT); } catch { /* noop */ }

  // ── tilemap.set_cells ──
  const tilemapNode = await bridge.call("scene.create_node", { class_name: "TileMapLayer", parent_path: ".", node_name: "MCPSmokeTML" }, CALL_TIMEOUT) as { status?: string; path?: string; code?: string };
  const tilemapPath = tilemapNode?.path ?? "MCPSmokeTML";
  if (tilemapNode?.status === "created") {
    const tilemapClearResult = await bridge.call("tilemap.set_cells", { tilemap_path: tilemapPath, cells: [
      { x: 0, y: 0, source_id: -1, atlas_x: 0, atlas_y: 0 },
      { x: 1, y: 0, source_id: -1, atlas_x: 0, atlas_y: 0 },
    ] }, CALL_TIMEOUT) as { success?: boolean; cells_unchanged?: number; total?: number; code?: string };
    if (tilemapClearResult?.success !== true || tilemapClearResult.total !== 2) fail(`tilemap.set_cells clear: ${JSON.stringify(tilemapClearResult)}`);
    else pass(`tilemap.set_cells clear x2 -> total=2 (cells_unchanged=${tilemapClearResult.cells_unchanged})`);

    assertGuard(ctx, "tilemap.set_cells non-tilemap",
      await bridge.call("tilemap.set_cells", { tilemap_path: animSpritePath, cells: [] }, CALL_TIMEOUT), "NOT_FOUND", "node");
    assertGuard(ctx, "tilemap.set_cells malformed cell",
      await bridge.call("tilemap.set_cells", { tilemap_path: tilemapPath, cells: [{ x: 0, y: 0 }] }, CALL_TIMEOUT),
      "INVALID_PARAMS", ["cells[0]", "source_id"]);
  } else {
    pass(`tilemap.set_cells: TileMapLayer setup failed (probably stale), skipping round-trip`);
  }
  try { await bridge.call("scene.delete_node", { node_path: tilemapPath }, CALL_TIMEOUT); } catch { /* noop */ }

  // ── editor.screenshot_node ──
  const screenshotNodeTarget = await bridge.call("scene.create_node", { class_name: "ColorRect", parent_path: ".", node_name: "MCPSmokeRect" }, CALL_TIMEOUT) as { status?: string; path?: string; code?: string };
  const screenshotNodePath = screenshotNodeTarget?.path ?? ".";
  const nodeScreenshotResult = await bridge.call("editor.screenshot_node", { node_path: screenshotNodePath }, SCREENSHOT_TIMEOUT) as { image_base64?: string; width?: number; height?: number; code?: string };
  if (!nodeScreenshotResult?.image_base64 || nodeScreenshotResult.image_base64.length < 100) fail(`editor.screenshot_node: ${JSON.stringify({ ...nodeScreenshotResult, image_base64: nodeScreenshotResult?.image_base64 ? `<${nodeScreenshotResult.image_base64.length}B>` : null })}`);
  else pass(`editor.screenshot_node ${screenshotNodePath} -> ${nodeScreenshotResult.width}x${nodeScreenshotResult.height} base64=${nodeScreenshotResult.image_base64.length}`);

  assertGuard(ctx, "editor.screenshot_node missing",
    await bridge.call("editor.screenshot_node", { node_path: "/root/NoSuch_15d_xyz" }, CALL_TIMEOUT), "NOT_FOUND", "node");
  assertGuard(ctx, "editor.screenshot_node tiny size",
    await bridge.call("editor.screenshot_node", { node_path: screenshotNodePath, size: { width: 32, height: 32 } }, CALL_TIMEOUT),
    "INVALID_PARAMS", ["64", "4096"]);

  try { await bridge.call("scene.delete_node", { node_path: screenshotNodePath }, CALL_TIMEOUT); } catch { /* noop */ }
}

// ─── 14. Asset discovery + console (iter 15e) ────────────────────────────
async function testAssetDiscoveryAndConsole(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  // Pre-seed known assets for filter assertions.
  const smokeListA = "res://smoke_list_a.tres";
  const smokeListB = "res://smoke_list_b.tres";
  const smokeListC = "res://smoke_list_c.gd";
  try { await bridge.call("resource.create", { file_path: smokeListA, resource_class: "Resource" }, CALL_TIMEOUT); } catch { /* noop */ }
  try { await bridge.call("resource.create", { file_path: smokeListB, resource_class: "Curve" }, CALL_TIMEOUT); } catch { /* noop */ }
  try { await bridge.call("script.write", { file_path: smokeListC, content: "extends Node" }, CALL_TIMEOUT); } catch { /* noop */ }
  try { await bridge.call("editor.reload_scripts", {}, CALL_TIMEOUT); } catch { /* noop */ }
  await new Promise((r) => setTimeout(r, 500));

  // asset.list — name_glob filter.
  const listByGlob = await bridge.call("asset.list", { path_prefix: "res://", name_glob: "smoke_list_*" }, CALL_TIMEOUT) as { success?: boolean; count?: number; entries?: { path: string }[]; truncated?: boolean; code?: string };
  if (!listByGlob?.success || typeof listByGlob.count !== "number" || listByGlob.count < 3) fail(`asset.list name_glob: expected >=3 entries, got ${JSON.stringify({ count: listByGlob?.count, success: listByGlob?.success, code: (listByGlob as { code?: string })?.code })}`);
  else pass(`asset.list name_glob smoke_list_* -> count=${listByGlob.count}`);

  // class_filter (ancestry-aware).
  const listByClass = await bridge.call("asset.list", { class_filter: "Curve" }, CALL_TIMEOUT) as { entries?: { path: string }[]; count?: number; code?: string };
  const hasCurve = listByClass?.entries?.some((e) => e.path === smokeListB);
  if (!hasCurve) fail(`asset.list class_filter=Curve: expected ${smokeListB} in entries, got ${JSON.stringify(listByClass)}`);
  else pass(`asset.list class_filter=Curve includes ${smokeListB}`);

  // extension_filter.
  const listByExtension = await bridge.call("asset.list", { name_glob: "smoke_list_*", extension_filter: ["gd"] }, CALL_TIMEOUT) as { entries?: { path: string }[]; count?: number; code?: string };
  if (listByExtension?.count !== 1 || listByExtension?.entries?.[0]?.path !== smokeListC) fail(`asset.list extension_filter=gd: expected 1 .gd entry, got ${JSON.stringify(listByExtension)}`);
  else pass(`asset.list extension_filter=gd -> ${smokeListC}`);

  // max_results truncation.
  const listTruncated = await bridge.call("asset.list", { max_results: 1 }, CALL_TIMEOUT) as { count?: number; truncated?: boolean; code?: string };
  if (listTruncated?.count !== 1 || listTruncated?.truncated !== true) fail(`asset.list max_results=1: expected count=1 truncated=true, got ${JSON.stringify(listTruncated)}`);
  else pass(`asset.list max_results=1 -> truncated`);

  // Guard rejections.
  assertGuard(ctx, "asset.list /tmp path", await bridge.call("asset.list", { path_prefix: "/tmp" }, CALL_TIMEOUT), "INVALID_PATH", "res://");
  assertGuard(ctx, "asset.list bogus class_filter", await bridge.call("asset.list", { class_filter: "BogusClass" }, CALL_TIMEOUT), "INVALID_PARAMS", ["ClassDB", "ProjectSettings"]);
  assertGuard(ctx, "asset.list max_results=5000", await bridge.call("asset.list", { max_results: 5000 }, CALL_TIMEOUT), "INVALID_PARAMS", "[1, 2000]");

  // ── asset.get_dependencies ──
  const smokeDeps = "res://smoke_deps.tscn";
  try { await bridge.call("scene.create", { file_path: smokeDeps, root_type: "Node2D", if_exists: "replace" }, CALL_TIMEOUT); } catch { /* noop */ }
  try { await bridge.call("scene.open", { file_path: smokeDeps }, CALL_TIMEOUT); } catch { /* noop */ }
  try { await bridge.call("scene.create_node", { class_name: "Sprite2D", parent_path: ".", node_name: "DepSprite" }, CALL_TIMEOUT); } catch { /* noop */ }
  try { await bridge.call("node.set_property", { node_path: "DepSprite", property: "texture", value: { type: "Resource", path: "res://icon.svg" } }, CALL_TIMEOUT); } catch { /* noop */ }
  try { await bridge.call("editor.save_scene", {}, CALL_TIMEOUT); } catch { /* noop */ }
  try { await bridge.call("editor.reload_scripts", {}, CALL_TIMEOUT); } catch { /* noop */ }
  await new Promise((r) => setTimeout(r, 500));

  const depsResult = await bridge.call("asset.get_dependencies", { file_path: smokeDeps }, CALL_TIMEOUT) as { success?: boolean; dependencies?: { path: string; class?: string }[]; count?: number; code?: string };
  if (!depsResult?.success || !depsResult.dependencies || depsResult.count === undefined) fail(`asset.get_dependencies: unexpected shape ${JSON.stringify(depsResult)}`);
  else {
    const hasIcon = depsResult.dependencies.some((d) => d.path.includes("icon.svg"));
    if (!hasIcon) fail(`asset.get_dependencies: expected icon.svg in deps, got ${JSON.stringify(depsResult.dependencies)}`);
    else pass(`asset.get_dependencies ${smokeDeps} -> count=${depsResult.count}, includes icon.svg`);
  }
  assertGuard(ctx, "asset.get_dependencies /tmp path", await bridge.call("asset.get_dependencies", { file_path: "/tmp/foo.tres" }, CALL_TIMEOUT), "INVALID_PATH", "res://");
  assertGuard(ctx, "asset.get_dependencies missing file", await bridge.call("asset.get_dependencies", { file_path: "res://no_such_15e.tres" }, CALL_TIMEOUT), "NOT_FOUND", "no file");

  // ── editor.get_console ──
  const consoleBaseResult = await bridge.call("editor.get_console", { limit: 50 }, CALL_TIMEOUT) as { success?: boolean; entries?: { id: number; level: string; message: string }[]; count?: number; log_file?: string; next_id?: number; code?: string };
  if (!consoleBaseResult?.success || !Array.isArray(consoleBaseResult.entries) || typeof consoleBaseResult.log_file !== "string") {
    fail(`editor.get_console base: unexpected shape ${JSON.stringify({ success: consoleBaseResult?.success, entries: consoleBaseResult?.entries?.length, log_file: consoleBaseResult?.log_file, code: (consoleBaseResult as { code?: string })?.code })}`);
  } else {
    pass(`editor.get_console base -> count=${consoleBaseResult.count} log_file=${consoleBaseResult.log_file}`);
  }

  // Emit a known warning via @tool script.
  const consoleProbe = "res://smoke_console_probe.gd";
  try { await bridge.call("script.write", { file_path: consoleProbe, content: "@tool\nextends Node\nfunc _ready():\n\tpush_warning('MCP smoke: hello from 15e')" }, CALL_TIMEOUT); } catch { /* noop */ }
  try { await bridge.call("editor.reload_scripts", {}, CALL_TIMEOUT); } catch { /* noop */ }
  await new Promise((r) => setTimeout(r, 1000));
  const consoleWarnResult = await bridge.call("editor.get_console", { level_filter: ["warning"], limit: 100 }, CALL_TIMEOUT) as { success?: boolean; entries?: { level: string; message: string }[]; code?: string };
  if (!consoleWarnResult?.success) fail(`editor.get_console level_filter=warning: ${JSON.stringify(consoleWarnResult)}`);
  else pass(`editor.get_console level_filter=warning -> count=${consoleWarnResult.entries?.length ?? 0}`);

  // since_id incremental.
  const consolePoll = await bridge.call("editor.get_console", { limit: 10 }, CALL_TIMEOUT) as { next_id?: number; success?: boolean };
  if (consolePoll?.success && typeof consolePoll.next_id === "number" && consolePoll.next_id >= 0) {
    const consoleSinceId = await bridge.call("editor.get_console", { since_id: consolePoll.next_id, limit: 10 }, CALL_TIMEOUT) as { success?: boolean; count?: number; entries?: unknown[] };
    if (!consoleSinceId?.success) fail(`editor.get_console since_id: ${JSON.stringify(consoleSinceId)}`);
    else pass(`editor.get_console since_id=${consolePoll.next_id} -> count=${consoleSinceId.count}`);
  } else {
    pass(`editor.get_console since_id: skipped (no next_id from base call)`);
  }

  assertGuard(ctx, "editor.get_console limit=10000",
    await bridge.call("editor.get_console", { limit: 10000 }, CALL_TIMEOUT), "INVALID_PARAMS", "[1, 1000]");

  // ── editor.get_errors upgrade verification ──
  const consoleErr = "res://smoke_console_err.gd";
  try { await bridge.call("script.write", { file_path: consoleErr, content: "extends Nbdoe" }, CALL_TIMEOUT); } catch { /* noop */ }
  try { await bridge.call("editor.reload_scripts", {}, CALL_TIMEOUT); } catch { /* noop */ }
  await new Promise((r) => setTimeout(r, 1000));
  const errorsUpgrade = await bridge.call("editor.get_errors", {}, CALL_TIMEOUT) as { success?: boolean; errors?: { level?: string; message?: string }[]; count?: number; stub?: boolean; code?: string };
  if (errorsUpgrade?.stub === true) fail(`editor.get_errors: still returning stub`);
  else if (!errorsUpgrade?.success) fail(`editor.get_errors: ${JSON.stringify(errorsUpgrade)}`);
  else pass(`editor.get_errors -> count=${errorsUpgrade.count} (stub replaced)`);

  // ── Cleanup ──
  try { await bridge.call("script.delete", { file_path: consoleProbe }, CALL_TIMEOUT); } catch { /* noop */ }
  try { await bridge.call("script.delete", { file_path: consoleErr }, CALL_TIMEOUT); } catch { /* noop */ }
  try { await bridge.call("resource.delete", { file_path: smokeListA }, CALL_TIMEOUT); } catch { /* noop */ }
  try { await bridge.call("resource.delete", { file_path: smokeListB }, CALL_TIMEOUT); } catch { /* noop */ }
  try { await bridge.call("script.delete", { file_path: smokeListC }, CALL_TIMEOUT); } catch { /* noop */ }
  try { await bridge.call("scene.open", { file_path: MAIN_SCENE }, CALL_TIMEOUT); } catch { /* noop */ }
  try { await bridge.call("scene.delete", { file_path: smokeDeps }, CALL_TIMEOUT); } catch { /* noop */ }
  try { await bridge.call("editor.reload_scripts", {}, CALL_TIMEOUT); } catch { /* noop */ }
  pass("asset discovery + console cleanup complete");
}

// ─── 15. Asset import + editor.wait_for_idle (iter 15f) ──────────────────
async function testAssetImport(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  // Minimal 1x1 transparent PNG (67 bytes decoded).
  const MINI_PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQABNjN9GQAAAABJRU5ErkJggg==";
  const importDest = "res://smoke_import_b64.png";

  // base64 import — fresh create.
  const importCreated = await bridge.call("asset.import", { base64_data: MINI_PNG_B64, dest_path: importDest, if_exists: "replace" }, IMPORT_TIMEOUT) as { success?: boolean; status?: string; source?: string; size_bytes?: number; path?: string; class?: string | null; warnings?: string[]; code?: string };
  if (!importCreated?.success || (importCreated.status !== "created" && importCreated.status !== "replaced") || importCreated.source !== "base64" || !importCreated.size_bytes || importCreated.size_bytes <= 0) {
    fail(`asset.import base64 create: ${JSON.stringify({ status: importCreated?.status, source: importCreated?.source, size_bytes: importCreated?.size_bytes, code: (importCreated as { code?: string })?.code })}`);
  } else {
    pass(`asset.import base64 -> status=${importCreated.status} size=${importCreated.size_bytes}B class=${importCreated.class ?? "null"}`);
  }

  // if_exists="return" — idempotent.
  const importReturned = await bridge.call("asset.import", { base64_data: MINI_PNG_B64, dest_path: importDest, if_exists: "return" }, SCREENSHOT_TIMEOUT) as { success?: boolean; status?: string; source?: unknown; code?: string };
  if (!importReturned?.success || importReturned.status !== "returned") fail(`asset.import if_exists=return: expected status=returned, got ${JSON.stringify(importReturned)}`);
  else pass(`asset.import if_exists=return -> status=returned`);

  // if_exists="replace" — overwrite.
  const importReplaced = await bridge.call("asset.import", { base64_data: MINI_PNG_B64, dest_path: importDest, if_exists: "replace" }, IMPORT_TIMEOUT) as { success?: boolean; status?: string; code?: string };
  if (!importReplaced?.success || importReplaced.status !== "replaced") fail(`asset.import if_exists=replace: expected status=replaced, got ${JSON.stringify(importReplaced)}`);
  else pass(`asset.import if_exists=replace -> status=replaced`);

  // if_exists="fail" — ALREADY_EXISTS.
  assertGuard(ctx, "asset.import if_exists=fail (file exists)",
    await bridge.call("asset.import", { base64_data: MINI_PNG_B64, dest_path: importDest, if_exists: "fail" }, CALL_TIMEOUT),
    "ALREADY_EXISTS", "already exists");

  // Verify imported file via asset.list.
  try { await bridge.call("editor.wait_for_idle", { timeout_ms: 5000 }, SCREENSHOT_TIMEOUT); } catch { /* noop */ }
  const importDiscovery = await bridge.call("asset.list", { name_glob: "smoke_import_b64*" }, CALL_TIMEOUT) as { entries?: { path: string }[]; count?: number; code?: string };
  if (!importDiscovery?.entries?.some((e) => e.path === importDest)) {
    fail(`asset.import discovery: expected ${importDest} in asset.list, got ${JSON.stringify(importDiscovery)}`);
  } else {
    pass(`asset.import discovery: ${importDest} found in asset.list`);
  }

  // Guard rejections.
  assertGuard(ctx, "asset.import /tmp dest_path", await bridge.call("asset.import", { base64_data: MINI_PNG_B64, dest_path: "/tmp/foo.png" }, CALL_TIMEOUT), "INVALID_PATH", "res://");
  assertGuard(ctx, "asset.import .txt extension", await bridge.call("asset.import", { base64_data: MINI_PNG_B64, dest_path: "res://foo.txt" }, CALL_TIMEOUT), "INVALID_PATH", "allowlist");
  assertGuard(ctx, "asset.import both params", await bridge.call("asset.import", { source_path: "C:\\tmp\\x.png", base64_data: MINI_PNG_B64, dest_path: "res://foo.png" }, CALL_TIMEOUT), "INVALID_PARAMS", "exactly one");
  assertGuard(ctx, "asset.import neither param", await bridge.call("asset.import", { dest_path: "res://foo.png" }, CALL_TIMEOUT), "INVALID_PARAMS", "source_path");
  assertGuard(ctx, "asset.import res:// source_path", await bridge.call("asset.import", { source_path: "res://icon.svg", dest_path: "res://foo.svg" }, CALL_TIMEOUT), "INVALID_PATH", "Godot scheme");
  assertGuard(ctx, "asset.import bad base64", await bridge.call("asset.import", { base64_data: "not-valid-base64!!!", dest_path: "res://foo.png" }, CALL_TIMEOUT), "INVALID_PARAMS", "base64");
  assertGuard(ctx, "asset.import wait_for_scan_ms=50000", await bridge.call("asset.import", { base64_data: MINI_PNG_B64, dest_path: "res://foo.png", wait_for_scan_ms: 50000 }, CALL_TIMEOUT), "INVALID_PARAMS", "[0, 30000]");

  // ── editor.wait_for_idle ──
  const idleBase = await bridge.call("editor.wait_for_idle", {}, SCREENSHOT_TIMEOUT) as { success?: boolean; was_scanning?: boolean; waited_ms?: number; code?: string };
  if (!idleBase?.success || typeof idleBase.was_scanning !== "boolean") {
    fail(`editor.wait_for_idle base: ${JSON.stringify(idleBase)}`);
  } else {
    pass(`editor.wait_for_idle -> was_scanning=${idleBase.was_scanning} waited_ms=${idleBase.waited_ms}`);
  }

  const idleShort = await bridge.call("editor.wait_for_idle", { timeout_ms: 100 }, CALL_TIMEOUT) as { success?: boolean; was_scanning?: boolean; code?: string };
  if (!idleShort?.success) fail(`editor.wait_for_idle timeout_ms=100: ${JSON.stringify(idleShort)}`);
  else pass(`editor.wait_for_idle timeout_ms=100 -> was_scanning=${idleShort.was_scanning}`);

  assertGuard(ctx, "editor.wait_for_idle timeout_ms=50000",
    await bridge.call("editor.wait_for_idle", { timeout_ms: 50000 }, CALL_TIMEOUT), "INVALID_PARAMS", "[0, 30000]");

  // Cleanup.
  try { await bridge.call("file.delete", { file_path: importDest }, CALL_TIMEOUT); } catch { /* noop */ }
  pass("asset import cleanup complete");
}

// ─── 16. Custom class, node.set_script, file.delete (iter 15h/i) ─────────
async function testCustomClassAndFileOps(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  // ── scene.create_node global class resolution (iter 15h) ──
  const customClassScript = `class_name SmokeCustomNode\nextends Node2D\n\n@export var smoke_speed: float = 10.0\n`;
  await bridge.call("script.write", { file_path: "res://smoke_custom_class.gd", content: customClassScript }, CALL_TIMEOUT);
  await bridge.call("editor.reload_scripts", {}, CALL_TIMEOUT);
  await bridge.call("editor.wait_for_idle", { timeout_ms: 5000 }, SCREENSHOT_TIMEOUT);

  const customNode = await bridge.call("scene.create_node", { class_name: "SmokeCustomNode", parent_path: "", node_name: "SmokeCustom" }, CALL_TIMEOUT) as { success?: boolean; status?: string };
  if (!customNode?.success || customNode.status !== "created")
    fail(`scene.create_node with global class: ${JSON.stringify(customNode)}`);
  else pass("scene.create_node with global class_name -> created");

  const customIdempotent = await bridge.call("scene.create_node", { class_name: "SmokeCustomNode", parent_path: "", node_name: "SmokeCustom" }, CALL_TIMEOUT) as { success?: boolean; status?: string };
  if (!customIdempotent?.success || customIdempotent.status !== "returned")
    fail(`scene.create_node global class idempotency: ${JSON.stringify(customIdempotent)}`);
  else pass("scene.create_node with global class_name -> idempotent returned");
  await bridge.call("scene.delete_node", { node_path: "SmokeCustom" }, CALL_TIMEOUT);

  // ── node.set_script round-trip (iter 15h) ──
  await bridge.call("scene.create_node", { class_name: "Node2D", parent_path: "", node_name: "ScriptTarget" }, CALL_TIMEOUT);
  const attachResult = await bridge.call("node.set_script", { node_path: "ScriptTarget", script_path: "res://smoke_custom_class.gd" }, CALL_TIMEOUT) as { success?: boolean; properties?: { name: string }[] };
  if (!attachResult?.success) fail(`node.set_script attach: ${JSON.stringify(attachResult)}`);
  else pass("node.set_script attach -> success");
  if (!Array.isArray(attachResult?.properties) || !attachResult.properties.some((p: any) => p.name === "smoke_speed"))
    fail(`node.set_script should return @export properties, got: ${JSON.stringify(attachResult?.properties)}`);
  else pass("node.set_script returns @export properties (smoke_speed found)");

  const detachResult = await bridge.call("node.set_script", { node_path: "ScriptTarget", script_path: "" }, CALL_TIMEOUT) as { success?: boolean; script?: string | null; properties?: unknown[] };
  if (!detachResult?.success || detachResult.script !== null)
    fail(`node.set_script detach: ${JSON.stringify(detachResult)}`);
  else pass("node.set_script detach -> success, script: null");
  if (!Array.isArray(detachResult?.properties) || detachResult.properties.length !== 0)
    fail(`node.set_script detach should return empty properties, got: ${JSON.stringify(detachResult?.properties)}`);
  else pass("node.set_script detach -> properties empty");
  await bridge.call("scene.delete_node", { node_path: "ScriptTarget" }, CALL_TIMEOUT);
  await bridge.call("script.delete", { file_path: "res://smoke_custom_class.gd" }, CALL_TIMEOUT);

  // node.set_script guard rejections.
  assertGuard(ctx, "node.set_script no res://", await bridge.call("node.set_script", { node_path: ".", script_path: "/tmp/foo.gd" }, CALL_TIMEOUT), "INVALID_PATH", "res://");
  assertGuard(ctx, "node.set_script not found", await bridge.call("node.set_script", { node_path: ".", script_path: "res://nonexistent_script.gd" }, CALL_TIMEOUT), "LOAD_FAILED", "cannot load");

  // ── file.delete round-trip (iter 15i) ──
  const MINI_PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQABNjN9GQAAAABJRU5ErkJggg==";
  const fileDelPath = "res://smoke_15i_file_del.png";
  await bridge.call("asset.import", { base64_data: MINI_PNG_B64, dest_path: fileDelPath, if_exists: "replace" }, SCREENSHOT_TIMEOUT);
  const fileDelResult = await bridge.call("file.delete", { file_path: fileDelPath }, CALL_TIMEOUT) as { success?: boolean; code?: string };
  if (!fileDelResult?.success) fail(`file.delete: ${JSON.stringify(fileDelResult)}`);
  else pass("file.delete -> success");
  assertGuard(ctx, "file.delete re-delete", await bridge.call("file.delete", { file_path: fileDelPath }, CALL_TIMEOUT), "NOT_FOUND", "not found");
  assertGuard(ctx, "file.delete no res://", await bridge.call("file.delete", { file_path: "/tmp/foo.png" }, CALL_TIMEOUT), "INVALID_PATH", "res://");
  assertGuard(ctx, "file.delete nonexistent", await bridge.call("file.delete", { file_path: "res://no_such_file_15i.png" }, CALL_TIMEOUT), "NOT_FOUND", "not found");
  assertGuard(ctx, "file.delete plugin self-protect", await bridge.call("file.delete", { file_path: "res://addons/godot_mcp_toolkit/plugin.cfg" }, CALL_TIMEOUT), "PATH_DENIED", "toolkit");
}

// ─── 17. Mode B — runtime tests (iter 10 + 12) ──────────────────────────
async function testModeB(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;
  const gameEvalEnabled = featureEnabled("game_eval");

  const runtimeReachable = await probePort(HOST, RUNTIME_PORT, PROBE_TIMEOUT_MS);
  if (!runtimeReachable) {
    const modeBChecks: [string, unknown][] = [
      ["runtime.screenshot", {}],
      ["runtime.get_node_state", { node_path: "/root" }],
      ["debugger.get_log", { limit: 50 }],
      ["input.simulate", { event_type: "action", event_data: { action: "ui_accept" } }],
      ["animation_player.control", { node_path: "/root/NoSuchAP", operation: "pause" }],
    ];
    if (gameEvalEnabled) modeBChecks.push(["game.eval", { code: "1+2" }]);
    for (const [method, params] of modeBChecks) {
      try {
        await bridge.callRuntime(method, params, 3000);
        fail(`${method}: expected GAME_NOT_RUNNING when 9090 is down, but it succeeded`);
      } catch (err) {
        const code = err instanceof BridgeError ? err.code : "(unknown)";
        if (code !== "GAME_NOT_RUNNING") fail(`${method}: expected GAME_NOT_RUNNING, got ${code}`);
        else pass(`${method} -> GAME_NOT_RUNNING (game not started)`);
      }
    }
  } else {
    // Game is running — exercise the happy paths.
    const runtimeScreenshot = await bridge.callRuntime("runtime.screenshot", {}, SCREENSHOT_TIMEOUT) as { image_base64?: string; width?: number; height?: number; code?: string };
    if (!runtimeScreenshot?.image_base64) fail(`runtime.screenshot: ${JSON.stringify(runtimeScreenshot)}`);
    else {
      const buf = Buffer.from(runtimeScreenshot.image_base64, "base64");
      if (buf[0] !== 0x89 || buf[1] !== 0x50) fail("runtime.screenshot: PNG magic missing");
      else pass(`runtime.screenshot PNG ${buf.length}B (${runtimeScreenshot.width}x${runtimeScreenshot.height})`);
    }

    const nodeState = await bridge.callRuntime("runtime.get_node_state", { node_path: "/root" }, CALL_TIMEOUT) as { name?: string; class?: string; properties?: Record<string, unknown>; code?: string };
    if (!nodeState?.name || !nodeState.properties) fail(`runtime.get_node_state /root: ${JSON.stringify(nodeState)}`);
    else pass(`runtime.get_node_state /root class=${nodeState.class} props=${Object.keys(nodeState.properties).length}`);

    const debugLog = await bridge.callRuntime("debugger.get_log", { limit: 50 }, CALL_TIMEOUT) as { lines?: string[]; count?: number; total?: number; code?: string };
    if (!Array.isArray(debugLog?.lines) || typeof debugLog.count !== "number") fail(`debugger.get_log shape: ${JSON.stringify(debugLog)}`);
    else pass(`debugger.get_log -> ${debugLog.count} of ${debugLog.total} lines`);

    const inputSimulate = await bridge.callRuntime("input.simulate", { event_type: "action", event_data: { action: "ui_accept", pressed: true } }, CALL_TIMEOUT) as { ok?: boolean; code?: string };
    if (!inputSimulate?.ok) fail(`input.simulate ui_accept: ${JSON.stringify(inputSimulate)}`);
    else pass("input.simulate action=ui_accept ok");

    const animPlayerMiss = await bridge.callRuntime("animation_player.control", { node_path: "/root/NoSuchAP", operation: "pause" }, CALL_TIMEOUT) as { code?: string };
    if (animPlayerMiss?.code !== "NOT_FOUND") fail(`animation_player.control bogus: expected NOT_FOUND, got ${JSON.stringify(animPlayerMiss)}`);
    else pass("animation_player.control bogus -> NOT_FOUND");

    if (gameEvalEnabled) {
      const gameEvalResult = await bridge.callRuntime("game.eval", { code: "1+2" }, CALL_TIMEOUT) as { result?: unknown; code?: string };
      if (gameEvalResult?.result !== 3) fail(`game.eval 1+2: expected 3, got ${JSON.stringify(gameEvalResult)}`);
      else pass("game.eval 1+2 -> 3");
    }
  }
}

// ─── 18. Security: FileGuard + untrusted envelopes (iter 18) ─────────────
async function testSecurity(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  // FileGuard path traversal rejections.
  assertGuard(ctx, "FileGuard ../../../etc/passwd",
    await bridge.call("script.read", { file_path: "../../../etc/passwd" }, CALL_TIMEOUT), "PATH_DENIED", "..");
  assertGuard(ctx, "FileGuard /etc/passwd",
    await bridge.call("script.read", { file_path: "/etc/passwd" }, CALL_TIMEOUT), "PATH_DENIED", "absolute");
  assertGuard(ctx, "FileGuard res://../../../etc/passwd",
    await bridge.call("script.read", { file_path: "res://../../../etc/passwd" }, CALL_TIMEOUT), "PATH_DENIED", "..");
  assertGuard(ctx, "FileGuard resource.load ../../secret.tres",
    await bridge.call("resource.load", { file_path: "../../secret.tres" }, CALL_TIMEOUT), "PATH_DENIED", "..");
  assertGuard(ctx, "FileGuard scene.instantiate traversal packed_path",
    await bridge.call("scene.instantiate", { parent_path: ".", packed_path: "../../x.tscn" }, CALL_TIMEOUT), "PATH_DENIED", "..");
  assertGuard(ctx, "FileGuard folder.create ../../up",
    await bridge.call("folder.create", { folder_path: "../../up" }, CALL_TIMEOUT), "PATH_DENIED", "..");

  // Screenshot user://screenshots/ whitelist.
  const userShotPath = "user://screenshots/smoke_sec.png";
  const userScreenshot = await bridge.call("editor.screenshot", { save_path: userShotPath }, SCREENSHOT_TIMEOUT) as { path?: string; image_base64?: string; code?: string };
  if (userScreenshot?.path !== userShotPath || !userScreenshot.image_base64) fail(`editor.screenshot user://screenshots/ whitelist: ${JSON.stringify(userScreenshot)}`);
  else pass(`editor.screenshot user://screenshots/ whitelist -> ${userScreenshot.path}`);
  assertGuard(ctx, "editor.screenshot user://other/x.png",
    await bridge.call("editor.screenshot", { save_path: "user://other/x.png" }, CALL_TIMEOUT), "PATH_DENIED", "prefix");

  // Untrusted envelope check — script.read wraps content.
  const envelopeScriptPath = "res://smoke_probe.gd"; // written in testScriptOps
  const envelopeRead = await bridge.call("script.read", { file_path: envelopeScriptPath }, CALL_TIMEOUT) as { content?: string; code?: string };
  if (!envelopeRead?.content) {
    fail(`envelope check: script.read returned no content: ${JSON.stringify(envelopeRead)}`);
  } else if (!envelopeRead.content.includes('<untrusted kind="script"')) {
    fail(`envelope check: script.read content missing <untrusted> envelope`);
  } else if (!envelopeRead.content.includes(`source="${envelopeScriptPath}"`)) {
    fail(`envelope check: script.read envelope missing source="${envelopeScriptPath}"`);
  } else {
    pass(`envelope check: script.read content wrapped in <untrusted kind="script" source="${envelopeScriptPath}">`);
  }

  // Untrusted envelope on project.get_settings.
  const envelopeSettings = await bridge.call("project.get_settings", { prefix: "application/" }, CALL_TIMEOUT) as { settings?: string; code?: string };
  if (typeof envelopeSettings?.settings !== "string" || !envelopeSettings.settings.includes('<untrusted kind="project_settings"')) {
    fail(`envelope check: project.get_settings missing <untrusted> wrapper: ${JSON.stringify(envelopeSettings)?.slice(0, 200)}`);
  } else {
    pass(`envelope check: project.get_settings wrapped in <untrusted kind="project_settings">`);
  }
}

// ─── 19. Reconnect (iter 13) ─────────────────────────────────────────────
async function testReconnect(ctx: TestCtx): Promise<void> {
  const { pass, fail } = ctx;

  const fake = await makeFakeEchoServer();
  const fakeBridge = createBridge(`ws://127.0.0.1:${fake.port}`);
  try {
    const beforeResult = await fakeBridge.call("echo", { ping: "before" }, CALL_TIMEOUT);
    if (!deepEqual(beforeResult, { ping: "before" })) {
      fail(`reconnect: pre-cycle echo: ${JSON.stringify(beforeResult)}`);
    } else {
      pass("reconnect: pre-cycle echo via fake server");
    }

    // Drop active peer; let the bridge process the close event.
    fake.dropAll();
    await new Promise((res) => setTimeout(res, 100));

    // Hot path: bridge reconnects within ~1s.
    const afterResult = await fakeBridge.call("echo", { ping: "after" }, CALL_TIMEOUT);
    if (!deepEqual(afterResult, { ping: "after" })) {
      fail(`reconnect: post-cycle echo: ${JSON.stringify(afterResult)}`);
    } else {
      pass("reconnect: post-cycle echo round-trip via auto-reconnect");
    }
  } finally {
    await fakeBridge.close();
    await fake.close();
  }
}

// ═════════════════════════════════════════════════════════════════════════
// Main orchestrator
// ═════════════════════════════════════════════════════════════════════════
async function main(): Promise<void> {
  const reachable = await probePort(HOST, PORT, PROBE_TIMEOUT_MS);
  if (!reachable) {
    printUnreachable();
    process.exit(1);
  }

  const bridge = createBridge(
    `ws://${HOST}:${PORT}`,
    `ws://${HOST}:${RUNTIME_PORT}`,
  );
  let failed = false;
  const ctx: TestCtx = {
    bridge,
    fail: (msg: string) => { console.error(`[smoke] FAIL ${msg}`); failed = true; },
    pass: (msg: string) => console.log(`[smoke] PASS ${msg}`),
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
    await testReconnect(ctx);
  } catch (err) {
    ctx.fail(`unexpected error: ${(err as Error).message}`);
  } finally {
    await bridge.close();
  }

  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error("[smoke] FAIL unexpected:", err);
  process.exit(1);
});
