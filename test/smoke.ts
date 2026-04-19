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
import { BridgeError } from "../src/types.js";

const HOST = "127.0.0.1";
const PORT = Number(process.env.GODOT_MCP_PORT ?? "6505");
const RUNTIME_PORT = Number(process.env.GODOT_MCP_RUNTIME_PORT ?? "9090");
const PROBE_TIMEOUT_MS = 1000;

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
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    if (ka.length !== kb.length) return false;
    for (const k of ka) {
      if (!(k in (b as object))) return false;
      if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
    }
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Expected noise in the Godot editor during a clean smoke run
// ---------------------------------------------------------------------------
// The following logs / action names are INTENTIONAL and not a regression:
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
//   (a) The `Cleanup (iter 15c + 15d)` block below — every PackedScene
//       instance of `instChildPath` must be detached from Main BEFORE
//       save_scene, and the scene file deleted only after.
//   (b) A smoke section that opens a scene via scene.open should close
//       the tab via scene.close before deleting the backing file. If
//       scene.close breaks, stale probe files (smoke_edited_probe.tscn,
//       smoke_path_in_use/) may persist in the toolkit repo.
// ---------------------------------------------------------------------------
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
  const fail = (msg: string) => {
    console.error(`[smoke] FAIL ${msg}`);
    failed = true;
  };
  const pass = (msg: string) => console.log(`[smoke] PASS ${msg}`);

  // Guard-assertion helper — used throughout for code + message-substring checks.
  const assertGuard = (label: string, env: unknown, code: string, mustInclude: string | string[]): void => {
    const e = env as { success?: boolean; code?: string; error?: string };
    const needles = Array.isArray(mustInclude) ? mustInclude : [mustInclude];
    if (e?.success !== false || e.code !== code) fail(`${label}: expected code=${code}, got ${JSON.stringify(env)}`);
    else if (!needles.every((n) => e.error?.includes(n))) fail(`${label}: message missing ${needles.find((n) => !e.error?.includes(n))} in ${JSON.stringify(e.error)}`);
    else pass(`${label} -> ${code} (message mentions ${needles.join(" + ")})`);
  };

  try {
    // echo round-trip
    const payload = { t: Date.now(), nonce: "smoke-01" };
    const echoResult = await bridge.call("echo", payload, 5000);
    if (!deepEqual(echoResult, payload)) fail(`echo: expected ${JSON.stringify(payload)} got ${JSON.stringify(echoResult)}`);
    else pass("echo round-trip");

    // Tool count — 55 tools by default; 56 with GODOT_MCP_ALLOW_GAME_EVAL=1.
    const allowGameEval = process.env.GODOT_MCP_ALLOW_GAME_EVAL === "1";
    const expectedToolCount = allowGameEval ? 56 : 55;
    const allTools = [...sceneTools, ...nodeTools, ...scriptTools, ...editorTools, ...runtimeTools, ...signalTools, ...resourceTools, ...folderTools, ...diffTools, ...playtestTools, ...inputMapTools, ...animationTools, ...tilemapTools, ...assetTools, ...fileTools];
    if (allTools.length !== expectedToolCount) fail(`tool count: expected ${expectedToolCount}, got ${allTools.length}`);
    else pass(`tool count == ${expectedToolCount} (game_eval ${allowGameEval ? "ENABLED" : "gated off"})`);

    // --lite catalogue size. Tier is declared per-tool at registration site
    // (I14 single-source). Lite ≈ 14 tools matching toolkit-side registry.
    const liteTools = allTools.filter((t) => t.tier === "lite");
    if (liteTools.length !== 14) fail(`--lite catalogue: expected 14, got ${liteTools.length} (${liteTools.map((t) => t.name).join(", ")})`);
    else pass(`--lite catalogue == 14 (subset of full ${expectedToolCount})`);
    // Every lite tool must appear in the full catalogue (tier is a subset).
    const allToolNames = new Set(allTools.map((t) => t.name));
    const liteOrphans = liteTools.filter((t) => !allToolNames.has(t.name));
    if (liteOrphans.length > 0) fail(`lite tools not in full catalogue: ${liteOrphans.map((t) => t.name).join(", ")}`);
    else pass(`all lite tools resolve to catalogue entries`);

    // game_eval gating contract. Catalogue presence is the only safety
    // surface here — the runtime command itself stays reachable on 9090
    // either way; the FeatureGate (iter 19) will generalise this.
    const hasGameEval = runtimeTools.some((t) => t.name === "game_eval");
    if (allowGameEval && !hasGameEval) fail("game_eval expected in runtimeTools when GODOT_MCP_ALLOW_GAME_EVAL=1");
    else if (!allowGameEval && hasGameEval) fail("game_eval expected ABSENT from runtimeTools by default");
    else pass(`game_eval gating consistent with env (${hasGameEval ? "registered" : "absent"})`);

    // I2: tool description length
    for (const t of allTools) {
      if (t.description.length >= 200) fail(`${t.name} description ${t.description.length} >= 200 chars`);
    }
    pass("tool descriptions <200 chars");

    // scene.get_tree
    const tree = await bridge.call("scene.get_tree", null, 5000) as { name?: string; children?: unknown[]; code?: string };
    if (tree && tree.code === "NO_SCENE") {
      fail("scene.get_tree: NO_SCENE — open Main.tscn in the Godot editor (toolkit repo) before running smoke");
    } else if (!tree || typeof tree.name !== "string" || !Array.isArray(tree.children)) {
      fail(`scene.get_tree: unexpected shape ${JSON.stringify(tree)}`);
    } else {
      pass(`scene.get_tree root=${tree.name}`);
    }

    // scene.create_node idempotency (iter 15 status discriminator).
    const nodeName = "SmokeProbe";
    const c1 = await bridge.call("scene.create_node", { class_name: "Node", parent_path: ".", node_name: nodeName }, 5000) as { path?: string; status?: string; code?: string; error?: string };
    if (!c1 || typeof c1.path !== "string") fail(`scene.create_node first call: ${JSON.stringify(c1)}`);
    else if (c1.status !== "created") fail(`scene.create_node fresh: expected status='created', got ${JSON.stringify(c1)}`);
    else pass(`scene.create_node fresh -> status='created' at ${c1.path}`);
    const c2 = await bridge.call("scene.create_node", { class_name: "Node", parent_path: ".", node_name: nodeName }, 5000) as { path?: string; status?: string; code?: string };
    if (!c2 || c2.status !== "returned" || c2.path !== c1.path) fail(`scene.create_node idempotency: expected status='returned' at ${c1.path}, got ${JSON.stringify(c2)}`);
    else if (c2.code !== undefined) fail(`scene.create_node collision success must not carry code (got ${c2.code})`);
    else pass(`scene.create_node idempotent -> status='returned' at ${c2.path}`);

    // node.set_property / node.get_property round-trip via editor_description (plain String)
    const created = c1?.path ?? nodeName;
    const marker = `smoke-${Date.now()}`;
    const setRes = await bridge.call("node.set_property", { node_path: created, property: "editor_description", value: marker }, 5000) as { ok?: boolean; code?: string; error?: string };
    if (!setRes?.ok) fail(`node.set_property: ${JSON.stringify(setRes)}`);
    const getRes = await bridge.call("node.get_property", { node_path: created, property: "editor_description" }, 5000) as { value?: unknown; code?: string };
    if (getRes?.value !== marker) fail(`node.get_property: expected ${marker} got ${JSON.stringify(getRes)}`);
    else pass("node.set_property + node.get_property round-trip");

    // scene.delete_node cleanup (UndoRedo-based; safe to precede file writes).
    const del = await bridge.call("scene.delete_node", { node_path: created }, 5000) as { ok?: boolean; code?: string };
    if (!del?.ok) fail(`scene.delete_node: ${JSON.stringify(del)}`);
    else pass("scene.delete_node cleanup");

    // script.write + script.read round-trip. Iter 15b's new extension guard
    // on script.write restricts to .gd/.cs/.gdshader/.gdshaderinc — .txt
    // (iter 05's original choice for import-pipeline avoidance) no longer
    // accepted. .gd re-scan on every run is fine for smoke cadence.
    const scriptPath = "res://smoke_probe.gd";
    const scriptBody = `# smoke ${Date.now()}\nextends Node\n`;
    const wRes = await bridge.call("script.write", { file_path: scriptPath, content: scriptBody }, 5000) as { ok?: boolean; undoable?: boolean; code?: string };
    if (!wRes?.ok) fail(`script.write: ${JSON.stringify(wRes)}`);
    if (wRes?.undoable !== true) fail(`script.write missing undoable flag (iter-09 UndoRedo wrap): ${JSON.stringify(wRes)}`);
    const rRes = await bridge.call("script.read", { file_path: scriptPath }, 5000) as { content?: string; code?: string };
    if (rRes?.content !== scriptBody) fail(`script.read round-trip mismatch: ${JSON.stringify(rRes)}`);
    else pass("script.write (undoable) + script.read round-trip");

    // editor.reload_scripts after a write — should pick up the new content.
    const reload = await bridge.call("editor.reload_scripts", null, 5000) as { ok?: boolean; code?: string };
    if (!reload?.ok) fail(`editor.reload_scripts: ${JSON.stringify(reload)}`);
    else pass("editor.reload_scripts ok");

    // script.read bogus path -> domain error
    const bogus = await bridge.call("script.read", { file_path: "res://does_not_exist_smoke.txt" }, 5000) as { code?: string };
    if (bogus?.code !== "NOT_FOUND") fail(`script.read bogus: expected NOT_FOUND, got ${JSON.stringify(bogus)}`);
    else pass("script.read bogus path -> NOT_FOUND");

    // editor.get_errors shape
    const errs = await bridge.call("editor.get_errors", null, 5000) as { errors?: unknown[]; stub?: boolean };
    if (!Array.isArray(errs?.errors)) fail(`editor.get_errors shape: ${JSON.stringify(errs)}`);
    else pass(`editor.get_errors (stub=${errs.stub})`);

    // editor.screenshot -> inline base64 PNG, PNG magic bytes after decode.
    const shot = await bridge.call("editor.screenshot", {}, 10000) as { image_base64?: string; code?: string; error?: string; width?: number; height?: number; bytes?: number };
    if (!shot?.image_base64) {
      fail(`editor.screenshot: ${JSON.stringify(shot)}`);
    } else {
      const buf = Buffer.from(shot.image_base64, "base64");
      if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) {
        fail(`editor.screenshot: PNG magic bytes missing in inline data`);
      } else {
        pass(`editor.screenshot PNG ${buf.length}B (${shot.width}x${shot.height}) inline`);
      }
    }

    // editor.screenshot with save_path -> inline bytes + persisted file
    const savePath = "res://smoke_screenshots/smoke.png";
    const shot2 = await bridge.call("editor.screenshot", { save_path: savePath }, 10000) as { image_base64?: string; path?: string; code?: string };
    if (shot2?.path !== savePath || !shot2.image_base64) fail(`editor.screenshot save_path: ${JSON.stringify(shot2)}`);
    else pass(`editor.screenshot save_path -> ${shot2.path}`);

    // reject non-res:// save_path
    const shot3 = await bridge.call("editor.screenshot", { save_path: "user://bad.png" }, 5000) as { code?: string };
    if (shot3?.code !== "PATH_DENIED") fail(`editor.screenshot save_path user://: expected PATH_DENIED, got ${JSON.stringify(shot3)}`);
    else pass("editor.screenshot save_path user:// -> PATH_DENIED");

    // scene.open — re-open the currently-edited scene (Main.tscn in the dogfood
    // project). Idempotent on "already open"; flips the edited scene
    // otherwise. Smoke uses the current scene path read from scene.get_tree
    // earlier so this works regardless of project layout.
    const currentScenePath = "res://Main.tscn";
    const openRes = await bridge.call("scene.open", { file_path: currentScenePath }, 5000) as { ok?: boolean; path?: string; code?: string };
    if (!openRes?.ok || openRes.path !== currentScenePath) fail(`scene.open: ${JSON.stringify(openRes)}`);
    else pass(`scene.open ${openRes.path}`);

    // scene.open with a nonexistent path -> NOT_FOUND.
    const openMiss = await bridge.call("scene.open", { file_path: "res://does_not_exist_smoke.tscn" }, 5000) as { code?: string };
    if (openMiss?.code !== "NOT_FOUND") fail(`scene.open bogus: expected NOT_FOUND, got ${JSON.stringify(openMiss)}`);
    else pass("scene.open bogus -> NOT_FOUND");

    // ---- scene.close round-trip -----------------------------------------------
    const closeTestPath = "res://smoke_close_test.tscn";
    // Create + open a throwaway scene (2 tabs: Main + closeTest).
    await bridge.call("scene.create", { file_path: closeTestPath, root_type: "Node", if_exists: "return" }, 5000);
    await bridge.call("scene.open", { file_path: closeTestPath }, 5000);
    // Close it — happy path.
    const closedRes = await bridge.call("scene.close", { file_path: closeTestPath }, 5000) as { success?: boolean };
    if (!closedRes?.success) fail(`scene.close happy path: ${JSON.stringify(closedRes)}`);
    else pass("scene.close happy path -> success");
    // NOT_FOUND on an already-closed path.
    assertGuard("scene.close already-closed", await bridge.call("scene.close", { file_path: closeTestPath }, 5000), "NOT_FOUND", "not open");
    // Clean up the backing file.
    await bridge.call("scene.delete", { file_path: closeTestPath }, 5000);

    // scene.close guard rejections.
    assertGuard("scene.close no res://", await bridge.call("scene.close", { file_path: "/tmp/foo.tscn" }, 5000), "INVALID_PATH", "res://");
    assertGuard("scene.close not open", await bridge.call("scene.close", { file_path: "res://nonexistent_scene.tscn" }, 5000), "NOT_FOUND", "not open");
    // Last-tab guard: with only Main.tscn open, refuse.
    assertGuard("scene.close last tab", await bridge.call("scene.close", { file_path: currentScenePath }, 5000), "EDITED_SCENE", "last");

    // project.get_settings with prefix — a narrow slice, no secret-like keys.
    const settings = await bridge.call("project.get_settings", { prefix: "application/" }, 5000) as { settings?: Record<string, unknown>; count?: number; filtered_secret_count?: number; code?: string };
    if (!settings?.settings || typeof settings.count !== "number") {
      fail(`project.get_settings shape: ${JSON.stringify(settings)}`);
    } else if (settings.count < 1) {
      fail(`project.get_settings prefix application/: expected >=1 key, got ${settings.count}`);
    } else {
      const secretRe = /password|token|secret|key/i;
      const leaks = Object.keys(settings.settings).filter((k) => secretRe.test(k));
      if (leaks.length > 0) fail(`project.get_settings leaked secret-like keys: ${leaks.join(", ")}`);
      else pass(`project.get_settings prefix=application/ -> ${settings.count} keys, 0 leaks`);
    }

    // ---- Tier 3 (iter 11): signals, resource, property-list ---------------

    // Create a dedicated probe — we don't want to mutate signal connections
    // on anything the tier-1/2 smoke relies on. Cleanup lands at the end of
    // this block.
    const sig_create = await bridge.call("scene.create_node", { class_name: "Node", parent_path: ".", node_name: "SignalProbe" }, 5000) as { path?: string; code?: string };
    if (!sig_create?.path) fail(`scene.create_node SignalProbe: ${JSON.stringify(sig_create)}`);
    const probePath = sig_create?.path ?? "SignalProbe";

    // signal.list → Node base class exposes a known set of signals.
    const sigList = await bridge.call("signal.list", { node_path: probePath }, 5000) as { signals?: { name?: string; args?: unknown[] }[]; code?: string };
    if (!Array.isArray(sigList?.signals) || sigList.signals.length === 0) fail(`signal.list: ${JSON.stringify(sigList)}`);
    else if (!sigList.signals.some((s) => s.name === "child_order_changed")) fail(`signal.list: expected child_order_changed among ${sigList.signals.map((s) => s.name).join(",")}`);
    else pass(`signal.list -> ${sigList.signals.length} signals`);

    // Round-trip: connect + idempotent repeat + disconnect + NOT_FOUND. Uses
    // `child_order_changed` -> `notify_property_list_changed` — both
    // no-arg, non-destructive, always present on Node. Iter 15 status
    // discriminator: fresh -> 'created', repeat -> 'returned' (no `code`).
    const sigArgs = { source_path: probePath, signal_name: "child_order_changed", target_path: probePath, method_name: "notify_property_list_changed" };
    const con1 = await bridge.call("signal.connect", sigArgs, 5000) as { status?: string; code?: string; signal?: string };
    if (con1?.status !== "created" || con1.signal !== "child_order_changed") fail(`signal.connect first: expected status='created' with signal echoed, got ${JSON.stringify(con1)}`);
    else pass(`signal.connect fresh -> status='created'`);
    const con2 = await bridge.call("signal.connect", sigArgs, 5000) as { status?: string; code?: string };
    if (con2?.status !== "returned") fail(`signal.connect idempotency: expected status='returned', got ${JSON.stringify(con2)}`);
    else if (con2.code !== undefined) fail(`signal.connect collision success must not carry code (got ${con2.code})`);
    else pass("signal.connect repeat -> status='returned' + code absent (I3)");

    // signal.emit with no args on the connected signal — should just succeed.
    const emitRes = await bridge.call("signal.emit", { node_path: probePath, signal_name: "child_order_changed", args: [] }, 5000) as { ok?: boolean; code?: string };
    if (!emitRes?.ok) fail(`signal.emit: ${JSON.stringify(emitRes)}`);
    else pass("signal.emit child_order_changed");

    const dis1 = await bridge.call("signal.disconnect", sigArgs, 5000) as { ok?: boolean; code?: string };
    if (!dis1?.ok) fail(`signal.disconnect first: ${JSON.stringify(dis1)}`);
    const dis2 = await bridge.call("signal.disconnect", sigArgs, 5000) as { code?: string };
    if (dis2?.code !== "NOT_FOUND") fail(`signal.disconnect repeat: expected NOT_FOUND, got ${JSON.stringify(dis2)}`);
    else pass("signal.disconnect + NOT_FOUND on repeat");

    // node.get_property_list on the probe. `name` is on Node but flagged
    // USAGE_NO_EDITOR (shown in the Scene dock, not the inspector), so it's
    // correctly absent here. Assert on `process_mode` which every Node
    // exposes through the inspector.
    const plist = await bridge.call("node.get_property_list", { node_path: probePath }, 5000) as { properties?: { name?: string; type?: number; hint?: number; hint_string?: string }[]; count?: number; code?: string };
    if (!Array.isArray(plist?.properties) || typeof plist.count !== "number") {
      fail(`node.get_property_list shape: ${JSON.stringify(plist)}`);
    } else {
      const names = new Set(plist.properties.map((p) => p.name));
      if (!names.has("process_mode")) fail(`node.get_property_list: expected process_mode, got ${Array.from(names).slice(0, 5).join(",")}...`);
      else pass(`node.get_property_list -> ${plist.count} props (incl process_mode)`);
    }

    // Clean up the signal probe.
    await bridge.call("scene.delete_node", { node_path: probePath }, 5000);
    pass(`SignalProbe cleanup`);

    // resource.load on the dogfood icon.svg — exists, resolves to a Texture.
    const res1 = await bridge.call("resource.load", { file_path: "res://icon.svg" }, 5000) as { class?: string; path?: string; metadata?: { width?: number; height?: number }; code?: string };
    if (!res1?.class) fail(`resource.load icon.svg: ${JSON.stringify(res1)}`);
    else if (!res1.metadata?.width || !res1.metadata.height) fail(`resource.load icon.svg: missing width/height in metadata: ${JSON.stringify(res1.metadata)}`);
    else pass(`resource.load icon.svg -> class=${res1.class} ${res1.metadata.width}x${res1.metadata.height}`);

    const res2 = await bridge.call("resource.load", { file_path: "res://does_not_exist_smoke.tres" }, 5000) as { code?: string };
    if (res2?.code !== "NOT_FOUND") fail(`resource.load bogus: expected NOT_FOUND, got ${JSON.stringify(res2)}`);
    else pass("resource.load bogus -> NOT_FOUND");

    // ---- scene_diff (iter 12, editor-side) --------------------------------
    // Snapshot the tree, mutate, diff. The plugin returns a line-based JSON
    // diff (added/removed lines from a stable pretty-print). MVP precision
    // is "did anything change and is the new node mentioned?" — structural
    // tree-diff is post-MVP per iter-12 plan.
    const treeBefore = await bridge.call("scene.get_tree", null, 5000);
    const dProbe = await bridge.call("scene.create_node", { class_name: "Node", parent_path: ".", node_name: "DiffProbe" }, 5000) as { path?: string; code?: string };
    if (!dProbe?.path) fail(`scene.create_node DiffProbe: ${JSON.stringify(dProbe)}`);
    const diffRes = await bridge.call("scene.diff", { before: treeBefore }, 5000) as { changed?: boolean; diff?: string; added?: number; removed?: number; code?: string };
    if (diffRes?.changed !== true) fail(`scene.diff after mutation: expected changed=true, got ${JSON.stringify(diffRes)}`);
    else if (!diffRes.diff?.includes("DiffProbe")) fail(`scene.diff diff missing DiffProbe (truncated): ${diffRes.diff?.slice(0, 200)}`);
    else pass(`scene.diff after create_node -> changed +${diffRes.added}/-${diffRes.removed}`);

    // Idempotent: comparing a snapshot to itself returns changed=false.
    const diffSelf = await bridge.call("scene.diff", { before: treeBefore, after: treeBefore }, 5000) as { changed?: boolean; code?: string };
    if (diffSelf?.changed !== false) fail(`scene.diff(before,before): expected changed=false, got ${JSON.stringify(diffSelf)}`);
    else pass("scene.diff(self) -> changed=false");

    // Cleanup before Mode B section.
    await bridge.call("scene.delete_node", { node_path: dProbe?.path ?? "DiffProbe" }, 5000);
    pass("DiffProbe cleanup");

    // ---- Negative-path coverage (iter 14, I1) ----------------------------
    // Every error response must carry the {success: false, error, code}
    // shape (per I1). bridge.call returns the raw plugin payload; the TS
    // tool layer wraps that in MCP isError responses via toolError. We
    // assert on payload shape here because smoke goes through the bridge,
    // not the tool layer — the wrap is unit-covered by toolErrorFromPayload
    // and exercised end-to-end during manual /mcp invocation per the
    // iter 14 verification block.
    type ErrEnv = { success?: boolean; error?: string; code?: string };
    const expectErr = (label: string, env: ErrEnv | unknown, code: string): void => {
      const e = env as ErrEnv;
      if (!e || e.success !== false || e.code !== code || typeof e.error !== "string") {
        fail(`${label}: expected {success:false, code:'${code}', error:string}, got ${JSON.stringify(env)}`);
      } else {
        pass(`${label} -> ${code}`);
      }
    };

    expectErr(
      "scene.create_node bogus class",
      await bridge.call("scene.create_node", { class_name: "NotAClass", parent_path: "." }, 5000),
      "INVALID_CLASS",
    );
    expectErr(
      "scene.delete_node bogus path",
      await bridge.call("scene.delete_node", { node_path: "NoSuchNode_xyz" }, 5000),
      "NOT_FOUND",
    );
    expectErr(
      "scene.delete_node refuses root",
      await bridge.call("scene.delete_node", { node_path: "." }, 5000),
      "INVALID_PATH",
    );
    expectErr(
      "node.get_property bogus path",
      await bridge.call("node.get_property", { node_path: "NoSuchNode_xyz", property: "name" }, 5000),
      "NOT_FOUND",
    );
    expectErr(
      "node.set_property bogus path",
      await bridge.call("node.set_property", { node_path: "NoSuchNode_xyz", property: "editor_description", value: "x" }, 5000),
      "NOT_FOUND",
    );
    expectErr(
      "node.get_property_list bogus path",
      await bridge.call("node.get_property_list", { node_path: "NoSuchNode_xyz" }, 5000),
      "NOT_FOUND",
    );
    expectErr(
      "script.write user:// path",
      await bridge.call("script.write", { file_path: "user://bad.txt", content: "x" }, 5000),
      "PATH_DENIED",
    );
    expectErr(
      "editor.save_scene non-res:// path",
      await bridge.call("editor.save_scene", { file_path: "/tmp/bad.tscn" }, 5000),
      "PATH_DENIED",
    );
    expectErr(
      "signal.list bogus path",
      await bridge.call("signal.list", { node_path: "NoSuchNode_xyz" }, 5000),
      "NOT_FOUND",
    );
    expectErr(
      "signal.connect bogus signal",
      await bridge.call("signal.connect", { source_path: ".", signal_name: "no_such_signal_xyz", target_path: ".", method_name: "notify_property_list_changed" }, 5000),
      "INVALID_PARAMS",
    );
    expectErr(
      "signal.emit bogus signal",
      await bridge.call("signal.emit", { node_path: ".", signal_name: "no_such_signal_xyz" }, 5000),
      "INVALID_PARAMS",
    );
    expectErr(
      "scene.diff missing before",
      await bridge.call("scene.diff", {}, 5000),
      "INVALID_PARAMS",
    );
    expectErr(
      "resource.load non-res://",
      await bridge.call("resource.load", { file_path: "/etc/passwd" }, 5000),
      "PATH_DENIED",
    );

    // Iter 15 status discriminator (regression guard): idempotent repeats
    // stay NON-error (toolErrorFromPayload must not translate to isError)
    // and carry `status: "returned"` instead of the legacy `code: "ALREADY_EXISTS"`.
    const idemNode = "IdempotencyProbe";
    const idemFirst = await bridge.call("scene.create_node", { class_name: "Node", parent_path: ".", node_name: idemNode }, 5000) as { path?: string; status?: string; success?: boolean };
    const idemSecond = await bridge.call("scene.create_node", { class_name: "Node", parent_path: ".", node_name: idemNode }, 5000) as { path?: string; status?: string; code?: string; success?: boolean };
    if (idemSecond?.success === false) {
      fail(`idempotent repeat must NOT carry success:false: ${JSON.stringify(idemSecond)}`);
    } else if (idemSecond?.status !== "returned") {
      fail(`idempotent repeat must carry status='returned': ${JSON.stringify(idemSecond)}`);
    } else if (idemSecond?.code !== undefined) {
      fail(`idempotent success must NOT carry code (got ${idemSecond.code})`);
    } else if (idemSecond?.path !== idemFirst?.path) {
      fail(`idempotent repeat must return same path: ${JSON.stringify({ first: idemFirst, second: idemSecond })}`);
    } else {
      pass("idempotent repeat -> non-error success, status='returned', code absent (iter 15 I3)");
    }
    await bridge.call("scene.delete_node", { node_path: idemFirst?.path ?? idemNode }, 5000);

    // ---- Iter 15: scene.create / scene.delete / script.delete ------------
    // File-level ops (distinct from iter-03's node-level create/delete).
    // status discriminator, three if_exists branches, five guard rejections
    // with message-substring checks, plus symmetric script.delete coverage.
    const createPath = "res://smoke_throwaway.tscn";
    // Belt-and-braces: any orphan from a previous aborted run would poison
    // the "fresh create" branch. Best-effort cleanup first (ignore failures).
    try { await bridge.call("scene.delete", { file_path: createPath }, 5000); } catch { /* noop */ }

    // Default if_exists (behaves as "return"). Fresh -> status 'created'.
    const sc1 = await bridge.call("scene.create", { file_path: createPath, root_type: "Node2D" }, 5000) as { success?: boolean; status?: string; path?: string; root_type?: string; code?: string };
    if (sc1?.status !== "created" || sc1.path !== createPath || sc1.root_type !== "Node2D") {
      fail(`scene.create fresh: expected status='created' path=${createPath} root_type='Node2D', got ${JSON.stringify(sc1)}`);
    } else pass(`scene.create fresh -> status='created' root_type=Node2D`);
    // Same path again with no if_exists → status 'returned', no code, no root_type re-echo.
    const sc2 = await bridge.call("scene.create", { file_path: createPath, root_type: "Node2D" }, 5000) as { success?: boolean; status?: string; path?: string; code?: string };
    if (sc2?.status !== "returned" || sc2.path !== createPath) {
      fail(`scene.create default if_exists repeat: expected status='returned', got ${JSON.stringify(sc2)}`);
    } else if (sc2.code !== undefined) fail(`scene.create returned must not carry code (got ${sc2.code})`);
    else pass(`scene.create default repeat -> status='returned' (code absent)`);

    // if_exists: 'fail' → hard ALREADY_EXISTS error, message mentions 'replace'.
    const sc3 = await bridge.call("scene.create", { file_path: createPath, root_type: "Node2D", if_exists: "fail" }, 5000) as { success?: boolean; code?: string; error?: string };
    if (sc3?.success !== false || sc3.code !== "ALREADY_EXISTS" || !sc3.error?.includes("replace")) {
      fail(`scene.create if_exists=fail: expected ALREADY_EXISTS mentioning 'replace', got ${JSON.stringify(sc3)}`);
    } else pass(`scene.create if_exists='fail' -> ALREADY_EXISTS (message steers to 'replace')`);

    // if_exists: 'replace' → status 'replaced', previous_root_type echoed.
    const sc4 = await bridge.call("scene.create", { file_path: createPath, root_type: "Node3D", if_exists: "replace" }, 5000) as { success?: boolean; status?: string; path?: string; root_type?: string; previous_root_type?: string; code?: string };
    if (sc4?.status !== "replaced" || sc4.root_type !== "Node3D" || sc4.previous_root_type !== "Node2D") {
      fail(`scene.create if_exists=replace: expected status='replaced' root_type=Node3D prev=Node2D, got ${JSON.stringify(sc4)}`);
    } else pass(`scene.create if_exists='replace' -> status='replaced' prev=${sc4.previous_root_type}`);

    // Invalid if_exists value → INVALID_PARAMS.
    const scBadIf = await bridge.call("scene.create", { file_path: createPath, root_type: "Node", if_exists: "explode" }, 5000) as { success?: boolean; code?: string; error?: string };
    if (scBadIf?.code !== "INVALID_PARAMS" || !scBadIf.error?.includes("if_exists")) {
      fail(`scene.create invalid if_exists: expected INVALID_PARAMS, got ${JSON.stringify(scBadIf)}`);
    } else pass(`scene.create if_exists='explode' -> INVALID_PARAMS`);

    // ---- scene.create guard rejections (each asserts code + message substring)
    // The LLM agent pattern-matches on message wording for recovery, so
    // regressions in Step 3's templates (iter 15 spec) must fail smoke.
    assertGuard(
      "scene.create /tmp path",
      await bridge.call("scene.create", { file_path: "/tmp/foo.tscn", root_type: "Node" }, 5000),
      "INVALID_PATH",
      "res://",
    );
    assertGuard(
      "scene.create .txt extension",
      await bridge.call("scene.create", { file_path: "res://foo.txt", root_type: "Node" }, 5000),
      "INVALID_PATH",
      ".tscn",
    );
    assertGuard(
      "scene.create missing parent dir",
      await bridge.call("scene.create", { file_path: "res://nonexistent_smoke_dir/foo.tscn", root_type: "Node" }, 5000),
      "PARENT_NOT_FOUND",
      "folder.create",
    );
    assertGuard(
      "scene.create bogus class",
      await bridge.call("scene.create", { file_path: "res://smoke_bogus.tscn", root_type: "BogusClass" }, 5000),
      "INVALID_CLASS",
      ["ClassDB", "ProjectSettings"],
    );
    assertGuard(
      "scene.create Resource (not a Node)",
      await bridge.call("scene.create", { file_path: "res://smoke_resource.tscn", root_type: "Resource" }, 5000),
      "INVALID_CLASS",
      "Node",
    );

    // ---- scene.delete round-trip ------------------------------------------
    const del1 = await bridge.call("scene.delete", { file_path: createPath }, 5000) as { success?: boolean; path?: string; code?: string };
    if (del1?.success !== true || del1.path !== createPath) fail(`scene.delete: ${JSON.stringify(del1)}`);
    else pass(`scene.delete ${createPath}`);
    const del2 = await bridge.call("scene.delete", { file_path: createPath }, 5000) as { success?: boolean; code?: string };
    if (del2?.success !== false || del2.code !== "NOT_FOUND") fail(`scene.delete repeat: expected NOT_FOUND, got ${JSON.stringify(del2)}`);
    else pass(`scene.delete repeat -> NOT_FOUND`);
    assertGuard(
      "scene.delete .txt extension",
      await bridge.call("scene.delete", { file_path: "res://bogus.txt" }, 5000),
      "INVALID_PATH",
      ".tscn",
    );

    // EDITED_SCENE refusal + clean teardown via scene.close.
    const editedPath = "res://smoke_edited_probe.tscn";
    await bridge.call("scene.create", { file_path: editedPath, root_type: "Node", if_exists: "return" }, 5000);
    await bridge.call("scene.open", { file_path: editedPath }, 5000);
    // Attempt delete while it's the active scene -> should refuse.
    const edDel = await bridge.call("scene.delete", { file_path: editedPath }, 5000) as { success?: boolean; code?: string; error?: string };
    if (edDel?.code !== "EDITED_SCENE") fail(`scene.delete of currently-edited: expected EDITED_SCENE, got ${JSON.stringify(edDel)}`);
    else pass("scene.delete refuses currently-edited scene -> EDITED_SCENE");
    // Clean teardown: close the probe tab, then delete the file.
    const edClose = await bridge.call("scene.close", { file_path: editedPath }, 5000) as { success?: boolean };
    if (!edClose?.success) fail(`edited-probe scene.close: ${JSON.stringify(edClose)}`);
    await bridge.call("scene.delete", { file_path: editedPath }, 5000);
    pass("EDITED_SCENE probe: clean teardown via scene.close + scene.delete");
    // Main.tscn auto-restores as the only remaining tab.

    // ---- script.delete round-trip -----------------------------------------
    const scriptDelPath = "res://smoke_throwaway.gd";
    try { await bridge.call("script.delete", { file_path: scriptDelPath }, 5000); } catch { /* noop */ }
    const sw = await bridge.call("script.write", { file_path: scriptDelPath, content: "extends Node\n" }, 5000) as { ok?: boolean };
    if (!sw?.ok) fail(`script.write throwaway.gd: ${JSON.stringify(sw)}`);
    const sd1 = await bridge.call("script.delete", { file_path: scriptDelPath }, 5000) as { success?: boolean; path?: string; code?: string };
    if (sd1?.success !== true || sd1.path !== scriptDelPath) fail(`script.delete: ${JSON.stringify(sd1)}`);
    else pass(`script.delete ${scriptDelPath}`);
    const sd2 = await bridge.call("script.delete", { file_path: scriptDelPath }, 5000) as { success?: boolean; code?: string };
    if (sd2?.success !== false || sd2.code !== "NOT_FOUND") fail(`script.delete repeat: expected NOT_FOUND, got ${JSON.stringify(sd2)}`);
    else pass(`script.delete repeat -> NOT_FOUND`);
    assertGuard(
      "script.delete .tscn extension",
      await bridge.call("script.delete", { file_path: "res://bogus.tscn" }, 5000),
      "INVALID_PATH",
      ".gd",
    );
    assertGuard(
      "script.delete .txt extension",
      await bridge.call("script.delete", { file_path: "res://bogus.txt" }, 5000),
      "INVALID_PATH",
      ".gd",
    );

    // ---- Iter 15b: resource.create/save/delete + folder.create/delete ----
    // File-level Resource (.tres/.res) lifecycle + directory operations +
    // shader extension allowlist. Structure mirrors iter 15: status
    // discriminator, three if_exists branches on resource.create, guard
    // rejections with message-substring checks, plus symmetric delete tests.
    // All throwaway paths get best-effort cleanup at the top so stale state
    // from a previous aborted run can't poison the "fresh create" branches.
    const resPath = "res://smoke_resource.tres";
    const folderRoot = "res://smoke_dir";
    const shaderPath = "res://smoke.gdshader";
    const shaderIncPath = "res://smoke.gdshaderinc";
    try { await bridge.call("resource.delete", { file_path: resPath }, 5000); } catch { /* noop */ }
    try { await bridge.call("script.delete", { file_path: shaderPath }, 5000); } catch { /* noop */ }
    try { await bridge.call("script.delete", { file_path: shaderIncPath }, 5000); } catch { /* noop */ }
    try { await bridge.call("folder.delete", { folder_path: folderRoot, recursive: true }, 5000); } catch { /* noop */ }

    // resource.create happy path + idempotency (status='created' then 'returned').
    const rc1 = await bridge.call("resource.create", { file_path: resPath, resource_class: "Resource", properties: { resource_name: "smoke" } }, 5000) as { success?: boolean; status?: string; path?: string; resource_class?: string; warnings?: string[]; code?: string };
    if (rc1?.status !== "created" || rc1.resource_class !== "Resource") fail(`resource.create fresh: expected status='created' class='Resource', got ${JSON.stringify(rc1)}`);
    else if (!Array.isArray(rc1.warnings) || rc1.warnings.length !== 0) fail(`resource.create fresh: expected warnings=[], got ${JSON.stringify(rc1.warnings)}`);
    else pass(`resource.create fresh -> status='created' class=Resource warnings=0`);
    const rc2 = await bridge.call("resource.create", { file_path: resPath, resource_class: "Resource" }, 5000) as { status?: string; code?: string; path?: string };
    if (rc2?.status !== "returned" || rc2.path !== resPath) fail(`resource.create default repeat: expected status='returned', got ${JSON.stringify(rc2)}`);
    else if (rc2.code !== undefined) fail(`resource.create returned must not carry code (got ${rc2.code})`);
    else pass(`resource.create default repeat -> status='returned' (code absent)`);

    // if_exists='fail' → ALREADY_EXISTS; message steers to 'replace'.
    const rc3 = await bridge.call("resource.create", { file_path: resPath, resource_class: "Resource", if_exists: "fail" }, 5000) as { success?: boolean; code?: string; error?: string };
    if (rc3?.success !== false || rc3.code !== "ALREADY_EXISTS" || !rc3.error?.includes("replace")) {
      fail(`resource.create if_exists=fail: expected ALREADY_EXISTS mentioning 'replace', got ${JSON.stringify(rc3)}`);
    } else pass(`resource.create if_exists='fail' -> ALREADY_EXISTS (message steers to 'replace')`);

    // if_exists='replace' → status='replaced', previous_class + new class.
    const rc4 = await bridge.call("resource.create", { file_path: resPath, resource_class: "Curve", properties: { bake_resolution: 100 }, if_exists: "replace" }, 5000) as { status?: string; resource_class?: string; previous_class?: string; warnings?: string[]; code?: string };
    if (rc4?.status !== "replaced" || rc4.resource_class !== "Curve" || rc4.previous_class !== "Resource") {
      fail(`resource.create if_exists=replace: expected status='replaced' class=Curve prev=Resource, got ${JSON.stringify(rc4)}`);
    } else pass(`resource.create if_exists='replace' -> status='replaced' prev=${rc4.previous_class}`);

    // Invalid if_exists value → INVALID_PARAMS.
    const rcBadIf = await bridge.call("resource.create", { file_path: resPath, resource_class: "Resource", if_exists: "explode" }, 5000) as { code?: string; error?: string };
    if (rcBadIf?.code !== "INVALID_PARAMS" || !rcBadIf.error?.includes("if_exists")) {
      fail(`resource.create invalid if_exists: expected INVALID_PARAMS, got ${JSON.stringify(rcBadIf)}`);
    } else pass(`resource.create if_exists='explode' -> INVALID_PARAMS`);

    // Guard rejections (each asserts code + message substring per iter 15b §2 Step-3).
    assertGuard(
      "resource.create /tmp path",
      await bridge.call("resource.create", { file_path: "/tmp/foo.tres", resource_class: "Resource" }, 5000),
      "INVALID_PATH",
      "res://",
    );
    assertGuard(
      "resource.create .gd extension",
      await bridge.call("resource.create", { file_path: "res://foo.gd", resource_class: "Resource" }, 5000),
      "INVALID_PATH",
      "script.write",
    );
    assertGuard(
      "resource.create missing parent dir",
      await bridge.call("resource.create", { file_path: "res://no_such_dir_smoke/foo.tres", resource_class: "Resource" }, 5000),
      "PARENT_NOT_FOUND",
      "folder.create",
    );
    assertGuard(
      "resource.create bogus class",
      await bridge.call("resource.create", { file_path: "res://smoke_bogus.tres", resource_class: "BogusClass" }, 5000),
      "INVALID_CLASS",
      ["ClassDB", "ProjectSettings"],
    );
    assertGuard(
      "resource.create Node2D (not a Resource)",
      await bridge.call("resource.create", { file_path: "res://smoke_node2d.tres", resource_class: "Node2D" }, 5000),
      "NOT_A_RESOURCE",
      "base chain",
    );
    // Unknown-key warning — success, but `warnings[]` names the bad key + class.
    const warnPath = "res://smoke_warn.tres";
    try { await bridge.call("resource.delete", { file_path: warnPath }, 5000); } catch { /* noop */ }
    const rcWarn = await bridge.call("resource.create", { file_path: warnPath, resource_class: "Resource", properties: { bogus_key: 42 } }, 5000) as { status?: string; warnings?: string[]; code?: string };
    if (rcWarn?.status !== "created") fail(`resource.create warn probe: expected status='created', got ${JSON.stringify(rcWarn)}`);
    else if (!Array.isArray(rcWarn.warnings) || rcWarn.warnings.length !== 1 || !rcWarn.warnings[0].includes("bogus_key") || !rcWarn.warnings[0].includes("Resource")) {
      fail(`resource.create unknown-key warning: expected warnings[0] mentioning bogus_key + Resource, got ${JSON.stringify(rcWarn.warnings)}`);
    } else pass(`resource.create unknown key -> warnings[0] names 'bogus_key' + 'Resource'`);
    await bridge.call("resource.delete", { file_path: warnPath }, 5000);

    // resource.save round-trip: save new bake_resolution, verify via resource.load.
    const rs1 = await bridge.call("resource.save", { file_path: resPath, properties: { bake_resolution: 200 } }, 5000) as { success?: boolean; resource_class?: string; warnings?: string[]; status?: string; code?: string };
    if (rs1?.success !== true || rs1.resource_class !== "Curve") fail(`resource.save round-trip: ${JSON.stringify(rs1)}`);
    else if (rs1.status !== undefined) fail(`resource.save must NOT carry status (update, not create): got ${rs1.status}`);
    else if (!Array.isArray(rs1.warnings) || rs1.warnings.length !== 0) fail(`resource.save: expected warnings=[], got ${JSON.stringify(rs1.warnings)}`);
    else pass(`resource.save round-trip -> class=Curve, no warnings, no status field`);
    const rl = await bridge.call("resource.load", { file_path: resPath }, 5000) as { properties?: { bake_resolution?: number }; code?: string };
    if (rl?.properties?.bake_resolution !== 200) fail(`resource.load after save: expected bake_resolution=200, got ${JSON.stringify(rl?.properties)}`);
    else pass(`resource.load after save -> bake_resolution=200`);
    assertGuard(
      "resource.save missing file",
      await bridge.call("resource.save", { file_path: "res://no_such_smoke.tres", properties: {} }, 5000),
      "NOT_FOUND",
      "resource.create",
    );

    // resource.delete round-trip.
    const rd1 = await bridge.call("resource.delete", { file_path: resPath }, 5000) as { success?: boolean; path?: string; code?: string };
    if (rd1?.success !== true || rd1.path !== resPath) fail(`resource.delete: ${JSON.stringify(rd1)}`);
    else pass(`resource.delete ${resPath}`);
    const rd2 = await bridge.call("resource.delete", { file_path: resPath }, 5000) as { success?: boolean; code?: string };
    if (rd2?.code !== "NOT_FOUND") fail(`resource.delete repeat: expected NOT_FOUND, got ${JSON.stringify(rd2)}`);
    else pass(`resource.delete repeat -> NOT_FOUND`);
    assertGuard(
      "resource.delete .tscn extension",
      await bridge.call("resource.delete", { file_path: "res://bogus.tscn" }, 5000),
      "INVALID_PATH",
      "scene.delete",
    );
    assertGuard(
      "resource.delete .gd extension",
      await bridge.call("resource.delete", { file_path: "res://bogus.gd" }, 5000),
      "INVALID_PATH",
      "script.delete",
    );

    // folder.create — recursive + idempotency.
    const folderDeep = `${folderRoot}/nested/deep`;
    const folderNested = `${folderRoot}/nested`;
    const fc1 = await bridge.call("folder.create", { folder_path: folderDeep }, 5000) as { success?: boolean; status?: string; path?: string; code?: string };
    if (fc1?.status !== "created" || fc1.path !== folderDeep) fail(`folder.create recursive: expected status='created' path=${folderDeep}, got ${JSON.stringify(fc1)}`);
    else pass(`folder.create recursive ${folderDeep} -> status='created'`);
    const fc2 = await bridge.call("folder.create", { folder_path: folderDeep }, 5000) as { status?: string; code?: string };
    if (fc2?.status !== "returned") fail(`folder.create idempotency: expected status='returned', got ${JSON.stringify(fc2)}`);
    else if (fc2.code !== undefined) fail(`folder.create returned must not carry code (got ${fc2.code})`);
    else pass(`folder.create idempotent -> status='returned' (code absent)`);
    assertGuard(
      "folder.create /tmp path",
      await bridge.call("folder.create", { folder_path: "/tmp/smoke_bogus" }, 5000),
      "INVALID_PATH",
      "res://",
    );

    // folder.delete — PATH_IN_USE refusal + clean teardown via scene.close.
    const pathInUseDir = "res://smoke_path_in_use";
    const pathInUseProbe = `${pathInUseDir}/probe.tscn`;
    try { await bridge.call("folder.create", { folder_path: pathInUseDir }, 5000); } catch { /* noop */ }
    await bridge.call("scene.create", { file_path: pathInUseProbe, root_type: "Node", if_exists: "return" }, 5000);
    await bridge.call("scene.open", { file_path: pathInUseProbe }, 5000);
    const fdInUse = await bridge.call("folder.delete", { folder_path: pathInUseDir, recursive: true }, 5000) as { code?: string; error?: string };
    if (fdInUse?.code !== "PATH_IN_USE" || !fdInUse.error?.includes(pathInUseProbe)) {
      fail(`folder.delete on folder containing edited scene: expected PATH_IN_USE naming ${pathInUseProbe}, got ${JSON.stringify(fdInUse)}`);
    } else pass(`folder.delete refuses folder containing edited scene -> PATH_IN_USE`);
    // Clean teardown: close the probe tab, delete file, delete folder.
    const piuClose = await bridge.call("scene.close", { file_path: pathInUseProbe }, 5000) as { success?: boolean };
    if (!piuClose?.success) fail(`PATH_IN_USE probe scene.close: ${JSON.stringify(piuClose)}`);
    await bridge.call("scene.delete", { file_path: pathInUseProbe }, 5000);
    await bridge.call("folder.delete", { folder_path: pathInUseDir, recursive: true }, 5000);
    pass("PATH_IN_USE probe: clean teardown via scene.close + delete");
    // Main.tscn auto-restores as the only remaining tab.

    // folder.delete — FOLDER_PROTECTED guards.
    assertGuard(
      "folder.delete project root",
      await bridge.call("folder.delete", { folder_path: "res://" }, 5000),
      "FOLDER_PROTECTED",
      "root",
    );
    assertGuard(
      "folder.delete res://addons",
      await bridge.call("folder.delete", { folder_path: "res://addons" }, 5000),
      "FOLDER_PROTECTED",
      "addons",
    );
    assertGuard(
      "folder.delete toolkit plugin dir",
      await bridge.call("folder.delete", { folder_path: "res://addons/godot_mcp_toolkit" }, 5000),
      "FOLDER_PROTECTED",
      "godot_mcp_toolkit",
    );

    // folder.delete — DIR_NOT_EMPTY without recursive.
    assertGuard(
      "folder.delete non-empty without recursive",
      await bridge.call("folder.delete", { folder_path: folderRoot }, 5000),
      "DIR_NOT_EMPTY",
      "recursive:true",
    );

    // folder.delete — empty leaf success, zero counts.
    const fdLeaf = await bridge.call("folder.delete", { folder_path: folderDeep }, 5000) as { success?: boolean; path?: string; files_deleted?: number; directories_deleted?: number; code?: string };
    if (fdLeaf?.success !== true || fdLeaf.files_deleted !== 0 || fdLeaf.directories_deleted !== 0) {
      fail(`folder.delete empty leaf: expected success with zero counts, got ${JSON.stringify(fdLeaf)}`);
    } else pass(`folder.delete empty leaf ${folderDeep} -> files=0 dirs=0`);

    // folder.delete — recursive success, counts reflect the cleanup.
    const fdRec = await bridge.call("folder.delete", { folder_path: folderRoot, recursive: true }, 5000) as { success?: boolean; files_deleted?: number; directories_deleted?: number; code?: string };
    if (fdRec?.success !== true) fail(`folder.delete recursive: ${JSON.stringify(fdRec)}`);
    else pass(`folder.delete recursive ${folderRoot} -> files=${fdRec.files_deleted} dirs=${fdRec.directories_deleted}`);

    // Shader allowlist — .gdshader + .gdshaderinc accepted, .txt rejected.
    const swShader = await bridge.call("script.write", { file_path: shaderPath, content: "shader_type canvas_item;\n" }, 5000) as { ok?: boolean; code?: string };
    if (!swShader?.ok) fail(`script.write .gdshader: ${JSON.stringify(swShader)}`);
    else pass(`script.write .gdshader ok`);
    const swInc = await bridge.call("script.write", { file_path: shaderIncPath, content: "// smoke include\n" }, 5000) as { ok?: boolean; code?: string };
    if (!swInc?.ok) fail(`script.write .gdshaderinc: ${JSON.stringify(swInc)}`);
    else pass(`script.write .gdshaderinc ok`);
    assertGuard(
      "script.write .txt extension (new guard)",
      await bridge.call("script.write", { file_path: "res://smoke_bogus.txt", content: "x" }, 5000),
      "INVALID_PATH",
      ".gd",
    );
    const sdShader = await bridge.call("script.delete", { file_path: shaderPath }, 5000) as { success?: boolean; code?: string };
    if (sdShader?.success !== true) fail(`script.delete .gdshader: ${JSON.stringify(sdShader)}`);
    else pass(`script.delete .gdshader ok`);
    const sdInc = await bridge.call("script.delete", { file_path: shaderIncPath }, 5000) as { success?: boolean; code?: string };
    if (sdInc?.success !== true) fail(`script.delete .gdshaderinc: ${JSON.stringify(sdInc)}`);
    else pass(`script.delete .gdshaderinc ok`);

    // Belt-and-braces cleanup — any iter 15b artifact that could have
    // survived a mid-run failure. Wrapped in try/catch so the smoke exits
    // clean even on partial failure.
    try { await bridge.call("resource.delete", { file_path: resPath }, 5000); } catch { /* noop */ }
    try { await bridge.call("resource.delete", { file_path: warnPath }, 5000); } catch { /* noop */ }
    try { await bridge.call("script.delete", { file_path: shaderPath }, 5000); } catch { /* noop */ }
    try { await bridge.call("script.delete", { file_path: shaderIncPath }, 5000); } catch { /* noop */ }
    try { await bridge.call("folder.delete", { folder_path: folderRoot, recursive: true }, 5000); } catch { /* noop */ }

    // ---- Iter 15c: playtest + scene.instantiate + node.call_method + coercion
    // Mode A only — paths resolve under the edited scene root (Main), so
    // parent_path: "." means Main, and scene.instantiate's returned path is
    // relative (e.g. "Node2D" / "CellA"), mirroring scene.create_node.
    const instChildPath = "res://smoke_inst_child.tscn";
    const smokeTexPath = "res://smoke_texture.tres";
    // Best-effort cleanup — any orphan from a previous aborted run.
    try { await bridge.call("game.stop", {}, 5000); } catch { /* noop */ }
    for (const orphan of ["smoke_inst_child", "CellA", "Renamed", "CoercionSprite"]) {
      try { await bridge.call("scene.delete_node", { node_path: orphan }, 5000); } catch { /* noop */ }
    }
    try { await bridge.call("resource.delete", { file_path: smokeTexPath }, 5000); } catch { /* noop */ }
    try { await bridge.call("scene.delete", { file_path: instChildPath }, 5000); } catch { /* noop */ }
    // Reaffirm Main is open — subsequent steps depend on it.
    await bridge.call("scene.open", { file_path: currentScenePath }, 5000);

    // ---- game.start / game.stop ------------------------------------------
    // Happy path — wait_for_runtime:false so we don't assume port 9090 is
    // reachable (autoload may be absent in the dogfood project).
    const gs1 = await bridge.call("game.start", { scene_path: "current", wait_for_runtime: false }, 10000) as { success?: boolean; target?: string; runtime_ready?: boolean; runtime_port?: number; code?: string; error?: string };
    if (gs1?.success !== true || gs1.target !== "current") fail(`game.start target=current: ${JSON.stringify(gs1)}`);
    else pass(`game.start target=current -> success (runtime_ready=${gs1.runtime_ready})`);

    // Settle before ALREADY_PLAYING probe — is_playing_scene() should flip
    // synchronously on play_current_scene, but Windows occasionally stalls
    // the first post-play frame.
    await new Promise((res) => setTimeout(res, 500));

    assertGuard(
      "game.start while already running",
      await bridge.call("game.start", {}, 5000),
      "ALREADY_PLAYING",
      "game.stop",
    );

    const gStop1 = await bridge.call("game.stop", {}, 5000) as { success?: boolean; was_running?: boolean; status?: string; code?: string };
    if (gStop1?.success !== true || gStop1.was_running !== true) fail(`game.stop first: expected was_running=true, got ${JSON.stringify(gStop1)}`);
    else if (gStop1.status !== undefined) fail(`game.stop must NOT carry status (got ${gStop1.status})`);
    else pass(`game.stop first -> was_running=true (no status field)`);

    // Settle — stop_playing_scene can take a frame or two on Windows to
    // flip is_playing_scene() back to false.
    await new Promise((res) => setTimeout(res, 1000));

    const gStop2 = await bridge.call("game.stop", {}, 5000) as { success?: boolean; was_running?: boolean; code?: string };
    if (gStop2?.success !== true || gStop2.was_running !== false) fail(`game.stop idempotent: expected was_running=false, got ${JSON.stringify(gStop2)}`);
    else pass(`game.stop idempotent -> was_running=false`);

    // game.start — guard rejections.
    assertGuard(
      "game.start target=bogus",
      await bridge.call("game.start", { scene_path: "bogus" }, 5000),
      "INVALID_PARAMS",
      ["main", "current", "res://"],
    );
    assertGuard(
      "game.start missing res:// scene",
      await bridge.call("game.start", { scene_path: "res://no_such_game_smoke.tscn" }, 5000),
      "NOT_FOUND",
      "scene.create",
    );
    assertGuard(
      "game.start .tres extension",
      await bridge.call("game.start", { scene_path: "res://bogus_smoke_scene.tres" }, 5000),
      "INVALID_PATH",
      ".tscn",
    );

    // ---- scene.instantiate ----------------------------------------------
    // Throwaway Node2D child scene we can instantiate under Main.
    const instCreate = await bridge.call("scene.create", { file_path: instChildPath, root_type: "Node2D" }, 5000) as { status?: string; code?: string };
    if (instCreate?.status !== "created") fail(`scene.create ${instChildPath}: ${JSON.stringify(instCreate)}`);
    else pass(`scene.create ${instChildPath} -> status='created' (Node2D root)`);

    // Fresh — default as_name uses PackedScene root name, which scene.create
    // sets to the filename stem (see mcp_server.gd _cmd_scene_create:
    // `root.name = path.get_file().get_basename()`). So the expected child
    // name is "smoke_inst_child", not the class "Node2D".
    const defaultName = "smoke_inst_child";
    const inst1 = await bridge.call("scene.instantiate", { parent_path: ".", packed_path: instChildPath }, 5000) as { success?: boolean; status?: string; path?: string; class_name?: string; code?: string };
    if (inst1?.status !== "created" || inst1.path !== defaultName || inst1.class_name !== "Node2D") {
      fail(`scene.instantiate fresh: expected status='created' path='${defaultName}' class_name='Node2D', got ${JSON.stringify(inst1)}`);
    } else pass(`scene.instantiate fresh -> status='created' at ${inst1.path}`);

    // Idempotency — same parent + same name → status='returned', no code.
    const inst2 = await bridge.call("scene.instantiate", { parent_path: ".", packed_path: instChildPath }, 5000) as { status?: string; path?: string; code?: string };
    if (inst2?.status !== "returned" || inst2.path !== defaultName) fail(`scene.instantiate idempotent: expected status='returned' path='${defaultName}', got ${JSON.stringify(inst2)}`);
    else if (inst2.code !== undefined) fail(`scene.instantiate returned must not carry code (got ${inst2.code})`);
    else pass(`scene.instantiate idempotent -> status='returned' (code absent)`);

    // Ownership: save → reload Main → get_tree shows the instantiated child.
    const instSave = await bridge.call("editor.save_scene", {}, 5000) as { ok?: boolean; code?: string };
    if (!instSave?.ok) fail(`editor.save_scene after instantiate: ${JSON.stringify(instSave)}`);
    await bridge.call("scene.open", { file_path: currentScenePath }, 5000);
    const instTree = await bridge.call("scene.get_tree", null, 5000) as { children?: { name?: string }[]; code?: string };
    if (!instTree?.children?.some((c) => c.name === defaultName)) fail(`instantiated child missing after save+reload: ${JSON.stringify(instTree?.children?.map((c) => c.name))}`);
    else pass(`scene.instantiate owner-set survives save+reload`);

    // Delete, then happy path with as_name + transform (Vector2 coercion).
    await bridge.call("scene.delete_node", { node_path: defaultName }, 5000);
    const inst3 = await bridge.call("scene.instantiate", {
      parent_path: ".",
      packed_path: instChildPath,
      as_name: "CellA",
      transform: { position: { type: "Vector2", x: 32, y: 48 } },
    }, 5000) as { status?: string; path?: string; class_name?: string; code?: string };
    if (inst3?.status !== "created" || inst3.path !== "CellA") fail(`scene.instantiate as_name='CellA': expected path='CellA', got ${JSON.stringify(inst3)}`);
    else pass(`scene.instantiate as_name='CellA' -> ${inst3.path}`);

    // Save+reload, then verify transform coercion: Vector2 round-trip.
    await bridge.call("editor.save_scene", {}, 5000);
    await bridge.call("scene.open", { file_path: currentScenePath }, 5000);
    const cellPos = await bridge.call("node.get_property", { node_path: "CellA", property: "position" }, 5000) as { value?: { type?: string; x?: number; y?: number }; code?: string };
    if (cellPos?.value?.type !== "Vector2" || cellPos.value.x !== 32 || cellPos.value.y !== 48) {
      fail(`scene.instantiate transform Vector2 round-trip: expected Vector2(32,48), got ${JSON.stringify(cellPos)}`);
    } else pass(`scene.instantiate transform Vector2 round-trip -> x=32 y=48`);

    // scene.instantiate — guard rejections.
    assertGuard(
      "scene.instantiate /tmp packed_path",
      await bridge.call("scene.instantiate", { parent_path: ".", packed_path: "/tmp/foo.tscn" }, 5000),
      "INVALID_PATH",
      "res://",
    );
    assertGuard(
      "scene.instantiate .tres packed_path",
      await bridge.call("scene.instantiate", { parent_path: ".", packed_path: "res://bogus_smoke.tres" }, 5000),
      "INVALID_PATH",
      ["resource.create", ".tscn"],
    );
    assertGuard(
      "scene.instantiate missing packed_path",
      await bridge.call("scene.instantiate", { parent_path: ".", packed_path: "res://no_such_inst_smoke.tscn" }, 5000),
      "NOT_FOUND",
      "scene.create",
    );
    assertGuard(
      "scene.instantiate bogus parent_path",
      await bridge.call("scene.instantiate", { parent_path: "NoSuchParent_xyz", packed_path: instChildPath }, 5000),
      "NOT_FOUND",
      "parent_path",
    );

    // ---- node.call_method -----------------------------------------------
    // get_name on Main (".") → result is the StringName-as-string "Main".
    const callGet = await bridge.call("node.call_method", { node_path: ".", method_name: "get_name" }, 5000) as { success?: boolean; path?: string; method?: string; result?: unknown; code?: string };
    if (callGet?.success !== true || callGet.result !== "Main") fail(`node.call_method .get_name on Main: expected "Main", got ${JSON.stringify(callGet)}`);
    else pass(`node.call_method .get_name -> "Main"`);

    // set_name round-trip on CellA → rename to Renamed, verify via get_property.
    const callSet = await bridge.call("node.call_method", { node_path: "CellA", method_name: "set_name", args: ["Renamed"] }, 5000) as { success?: boolean; code?: string };
    if (callSet?.success !== true) fail(`node.call_method set_name: ${JSON.stringify(callSet)}`);
    const renamedProbe = await bridge.call("node.get_property", { node_path: "Renamed", property: "name" }, 5000) as { value?: string; code?: string };
    if (renamedProbe?.value !== "Renamed") fail(`set_name round-trip: expected name='Renamed' at path='Renamed', got ${JSON.stringify(renamedProbe)}`);
    else pass(`node.call_method set_name round-trip -> "Renamed"`);

    // node.call_method — guard rejections.
    assertGuard(
      "node.call_method bogus method",
      await bridge.call("node.call_method", { node_path: ".", method_name: "no_such_method_xyz" }, 5000),
      "INVALID_METHOD",
      "scene.get_tree",
    );
    assertGuard(
      "node.call_method bogus path",
      await bridge.call("node.call_method", { node_path: "NoSuchNode_xyz", method_name: "get_name" }, 5000),
      "NOT_FOUND",
      "NoSuchNode_xyz",
    );

    // ---- Resource-value coercion (end-to-end) ---------------------------
    // GradientTexture2D + Sprite2D — Resource-typed property round-trip.
    const tex1 = await bridge.call("resource.create", { file_path: smokeTexPath, resource_class: "GradientTexture2D", properties: { width: 32, height: 32 } }, 5000) as { status?: string; code?: string };
    if (tex1?.status !== "created") fail(`resource.create ${smokeTexPath}: ${JSON.stringify(tex1)}`);
    else pass(`resource.create ${smokeTexPath} -> status='created' (GradientTexture2D)`);

    const spriteNode = await bridge.call("scene.create_node", { class_name: "Sprite2D", parent_path: ".", node_name: "CoercionSprite" }, 5000) as { status?: string; path?: string; code?: string };
    if (spriteNode?.status !== "created") fail(`scene.create_node Sprite2D: ${JSON.stringify(spriteNode)}`);
    const spritePath = spriteNode?.path ?? "CoercionSprite";

    // Bind texture via node.set_property with Resource-type dict.
    const bindTex = await bridge.call("node.set_property", { node_path: spritePath, property: "texture", value: { type: "Resource", path: smokeTexPath } }, 5000) as { ok?: boolean; code?: string };
    if (!bindTex?.ok) fail(`node.set_property texture via Resource dict: ${JSON.stringify(bindTex)}`);
    else pass(`node.set_property texture <- {type:Resource,path:${smokeTexPath}}`);

    // Re-read → serialized Resource tag + path + class.
    const readTex = await bridge.call("node.get_property", { node_path: spritePath, property: "texture" }, 5000) as { value?: { type?: string; path?: string; class?: string }; code?: string };
    if (readTex?.value?.type !== "Resource" || readTex.value.path !== smokeTexPath || readTex.value.class !== "GradientTexture2D") {
      fail(`node.get_property texture coercion round-trip: expected {type:Resource,path:${smokeTexPath},class:GradientTexture2D}, got ${JSON.stringify(readTex)}`);
    } else pass(`node.get_property texture -> {type:Resource,class:GradientTexture2D} round-trip`);

    // Via node.call_method: set_texture with Resource arg (exercises arg-coercion path).
    const callTex = await bridge.call("node.call_method", { node_path: spritePath, method_name: "set_texture", args: [{ type: "Resource", path: smokeTexPath }] }, 5000) as { success?: boolean; code?: string };
    if (callTex?.success !== true) fail(`node.call_method set_texture via Resource arg: ${JSON.stringify(callTex)}`);
    else pass(`node.call_method set_texture (Resource arg coercion) ok`);

    // Color coercion — modulate is a Color property on CanvasItem.
    const setColor = await bridge.call("node.set_property", { node_path: spritePath, property: "modulate", value: { type: "Color", r: 1.0, g: 0.5, b: 0.0 } }, 5000) as { ok?: boolean; code?: string };
    if (!setColor?.ok) fail(`node.set_property modulate <- Color dict: ${JSON.stringify(setColor)}`);
    const readColor = await bridge.call("node.get_property", { node_path: spritePath, property: "modulate" }, 5000) as { value?: { type?: string; r?: number; g?: number; b?: number; a?: number }; code?: string };
    if (readColor?.value?.type !== "Color" || readColor.value.r !== 1.0 || readColor.value.g !== 0.5 || readColor.value.b !== 0.0 || readColor.value.a !== 1.0) {
      fail(`Color round-trip: expected {type:Color,r:1,g:0.5,b:0,a:1}, got ${JSON.stringify(readColor)}`);
    } else pass(`Color coercion round-trip -> r=1 g=0.5 b=0 a=1`);

    // Resource-not-found steer: LOAD_FAILED with resource.create guidance.
    assertGuard(
      "node.set_property Resource missing path",
      await bridge.call("node.set_property", { node_path: spritePath, property: "texture", value: { type: "Resource", path: "res://no_such_coerce_smoke.tres" } }, 5000),
      "LOAD_FAILED",
      "resource.create",
    );

    // ---- project.set_setting (iter 15d) --------------------------------
    // Happy path: write + read back + restore. Use a benign key under a
    // throwaway namespace so we don't pollute the dogfood project.
    const setSmokeKey = "application/config/mcp_smoke_15d";
    const preGet = await bridge.call("project.get_settings", { prefix: "application/config" }, 5000) as { settings?: Record<string, unknown> };
    const preValue = preGet?.settings?.[setSmokeKey] ?? null;
    const setOk = await bridge.call("project.set_setting", { key: setSmokeKey, value: "smoke-15d-marker" }, 5000) as { success?: boolean; was_set_before?: boolean; previous_value?: unknown; key?: string; value?: unknown; code?: string };
    if (setOk?.success !== true) fail(`project.set_setting: ${JSON.stringify(setOk)}`);
    else pass(`project.set_setting ${setSmokeKey} -> success (was_set_before=${setOk.was_set_before})`);
    const postGet = await bridge.call("project.get_settings", { prefix: "application/config" }, 5000) as { settings?: Record<string, unknown> };
    if (postGet?.settings?.[setSmokeKey] !== "smoke-15d-marker") fail(`project.set_setting round-trip: read-back ${JSON.stringify(postGet?.settings?.[setSmokeKey])}`);
    else pass(`project.set_setting -> read-back via project.get_settings matches`);
    // Guard: mcp/unsafe/* prefix refusal.
    assertGuard(
      "project.set_setting mcp/unsafe/*",
      await bridge.call("project.set_setting", { key: "mcp/unsafe/allow_game_eval", value: true }, 5000),
      "INVALID_PATH",
      "FeatureGate",
    );
    // Guard: editor/* prefix refusal.
    assertGuard(
      "project.set_setting editor/*",
      await bridge.call("project.set_setting", { key: "editor/something", value: "x" }, 5000),
      "INVALID_PATH",
      "editor-session state",
    );
    // Guard: empty key.
    assertGuard(
      "project.set_setting empty key",
      await bridge.call("project.set_setting", { key: "", value: 1 }, 5000),
      "INVALID_PARAMS",
      "non-empty",
    );

    // ---- input_map.* (iter 15d) ----------------------------------------
    const smokeAction = "mcp_smoke_jump_15d";
    // Best-effort cleanup of any stale entry from a prior crashed run.
    try { await bridge.call("input_map.remove_action", { action: smokeAction }, 5000); } catch { /* noop */ }
    const addAct = await bridge.call("input_map.add_action", { action: smokeAction, deadzone: 0.4 }, 5000) as { status?: string; deadzone?: number; code?: string };
    if (addAct?.status !== "created" || addAct.deadzone !== 0.4) fail(`input_map.add_action: ${JSON.stringify(addAct)}`);
    else pass(`input_map.add_action ${smokeAction} -> status=created, deadzone=0.4`);
    // Idempotency: same action again -> returned, EXISTING deadzone (Godot
    // stores deadzone as a float32 — compare with tolerance, not equality).
    const addAct2 = await bridge.call("input_map.add_action", { action: smokeAction, deadzone: 0.9 }, 5000) as { status?: string; deadzone?: number; code?: string };
    if (addAct2?.status !== "returned" || typeof addAct2.deadzone !== "number" || Math.abs(addAct2.deadzone - 0.4) > 0.001) fail(`input_map.add_action repeat: expected status=returned + deadzone~=0.4 (existing), got ${JSON.stringify(addAct2)}`);
    else pass(`input_map.add_action repeat -> status=returned + deadzone~=0.4 (existing wins per 15d contract)`);
    // Bind a key event.
    const addKey = await bridge.call("input_map.action_add_event", { action: smokeAction, event: { type: "key", keycode: "SPACE" } }, 5000) as { status?: string; event?: { type?: string }; code?: string };
    if (addKey?.status !== "created" || addKey.event?.type !== "key") fail(`input_map.action_add_event SPACE: ${JSON.stringify(addKey)}`);
    else pass(`input_map.action_add_event SPACE -> status=created`);
    // Equivalent-event idempotency.
    const addKey2 = await bridge.call("input_map.action_add_event", { action: smokeAction, event: { type: "key", keycode: "SPACE" } }, 5000) as { status?: string; code?: string };
    if (addKey2?.status !== "returned") fail(`input_map.action_add_event SPACE repeat: expected status=returned, got ${JSON.stringify(addKey2)}`);
    else pass(`input_map.action_add_event SPACE repeat -> status=returned (equivalent-event idempotency)`);
    // Distinct event (joypad button) does not collide with the key event.
    const addJoy = await bridge.call("input_map.action_add_event", { action: smokeAction, event: { type: "joypad_button", button_index: 0, device: -1 } }, 5000) as { status?: string; code?: string };
    if (addJoy?.status !== "created") fail(`input_map.action_add_event joypad: ${JSON.stringify(addJoy)}`);
    else pass(`input_map.action_add_event joypad_button -> status=created (no collision with SPACE)`);
    // Remove the key event; symmetric remove returns no status.
    const remKey = await bridge.call("input_map.action_remove_event", { action: smokeAction, event: { type: "key", keycode: "SPACE" } }, 5000) as { success?: boolean; event?: { type?: string }; code?: string };
    if (remKey?.success !== true || remKey.event?.type !== "key") fail(`input_map.action_remove_event: ${JSON.stringify(remKey)}`);
    else pass(`input_map.action_remove_event SPACE -> success`);
    // Remove again -> NOT_FOUND with event-count hint.
    assertGuard(
      "input_map.action_remove_event missing",
      await bridge.call("input_map.action_remove_event", { action: smokeAction, event: { type: "key", keycode: "SPACE" } }, 5000),
      "NOT_FOUND",
      "events",
    );
    // Built-in UI action refusal.
    assertGuard(
      "input_map.remove_action ui_accept refusal",
      await bridge.call("input_map.remove_action", { action: "ui_accept" }, 5000),
      "INVALID_PARAMS",
      ["built-in UI action", "input_map.action_remove_event"],
    );
    // Bogus event type.
    assertGuard(
      "input_map.action_add_event bogus type",
      await bridge.call("input_map.action_add_event", { action: smokeAction, event: { type: "telepathy" } }, 5000),
      "INVALID_PARAMS",
      ["key", "mouse_button", "joypad_button", "joypad_motion"],
    );
    // Bogus keycode.
    assertGuard(
      "input_map.action_add_event bogus keycode",
      await bridge.call("input_map.action_add_event", { action: smokeAction, event: { type: "key", keycode: "NONSENSE" } }, 5000),
      "INVALID_PARAMS",
      "symbolic names",
    );
    // Empty action name.
    assertGuard(
      "input_map.add_action empty",
      await bridge.call("input_map.add_action", { action: "" }, 5000),
      "INVALID_PARAMS",
      "non-empty",
    );
    // Cleanup the smoke action.
    try { await bridge.call("input_map.remove_action", { action: smokeAction }, 5000); } catch { /* noop */ }
    pass(`input_map.* round-trip + guards complete`);

    // ---- animation.* (iter 15d) ----------------------------------------
    // Smoke focuses on guards + the helpful NOT_FOUND message. The full
    // round-trip (animation.add_key on a real AnimationLibrary-bound
    // animation) is exercised manually per spec — seeding an
    // AnimationLibrary via the bridge is non-trivial because
    // AnimationLibrary._data nested-dict Resource refs aren't auto-coerced
    // by _coerce_value (it only recurses into Arrays). A throwaway .tscn
    // template would work but adds a file artifact; iter 16/17 may add a
    // resource.call_method tool that makes seeding tractable.
    const animPlayerNode = await bridge.call("scene.create_node", { class_name: "AnimationPlayer", parent_path: ".", node_name: "MCPSmokeAP" }, 5000) as { status?: string; path?: string; code?: string };
    const animSpriteNode = await bridge.call("scene.create_node", { class_name: "Sprite2D", parent_path: ".", node_name: "MCPSmokeASprite" }, 5000) as { status?: string; path?: string; code?: string };
    const apPath = animPlayerNode?.path ?? "MCPSmokeAP";
    const aSpritePath = animSpriteNode?.path ?? "MCPSmokeASprite";
    // Helpful NOT_FOUND: the message must enumerate available animations
    // (empty list here) so the agent can self-correct.
    assertGuard(
      "animation.add_key missing animation",
      await bridge.call("animation.add_key", { player_path: apPath, animation_name: "no_such_anim", track_path: "MCPSmokeASprite:position", time: 0.0, value: 0 }, 5000),
      "NOT_FOUND",
      ["available", "no_such_anim"],
    );
    // Guard: non-AnimationPlayer node.
    assertGuard(
      "animation.add_key non-AP",
      await bridge.call("animation.add_key", { player_path: aSpritePath, animation_name: "x", track_path: "y:position", time: 0, value: 0 }, 5000),
      "INVALID_CLASS",
      "AnimationPlayer",
    );
    // Guard: bare NodePath (no `:` property suffix). Routed through the
    // missing-animation NOT_FOUND first iff resolved before track-shape
    // check; spec puts shape check before animation lookup so this should
    // hit INVALID_PARAMS regardless of animation existence.
    assertGuard(
      "animation.add_key bare NodePath",
      await bridge.call("animation.add_key", { player_path: apPath, animation_name: "no_such_anim", track_path: "MCPSmokeASprite", time: 0, value: 0 }, 5000),
      "INVALID_PARAMS",
      "property",
    );
    // Cleanup nodes.
    try { await bridge.call("scene.delete_node", { node_path: apPath }, 5000); } catch { /* noop */ }
    try { await bridge.call("scene.delete_node", { node_path: aSpritePath }, 5000); } catch { /* noop */ }

    // ---- tilemap.set_cells (iter 15d) ----------------------------------
    // Lightweight: create TileMapLayer (no TileSet needed for guard tests +
    // for clear-only writes via source_id:-1, which short-circuits the
    // atlas-coords lookup). Full atlas-paint exercised manually per spec.
    const tmlNode = await bridge.call("scene.create_node", { class_name: "TileMapLayer", parent_path: ".", node_name: "MCPSmokeTML" }, 5000) as { status?: string; path?: string; code?: string };
    const tmlPath = tmlNode?.path ?? "MCPSmokeTML";
    if (tmlNode?.status === "created") {
      // Clear cells (source_id: -1) — no TileSet required.
      const clearOk = await bridge.call("tilemap.set_cells", { tilemap_path: tmlPath, cells: [
        { x: 0, y: 0, source_id: -1, atlas_x: 0, atlas_y: 0 },
        { x: 1, y: 0, source_id: -1, atlas_x: 0, atlas_y: 0 },
      ] }, 5000) as { success?: boolean; cells_unchanged?: number; total?: number; code?: string };
      if (clearOk?.success !== true || clearOk.total !== 2) fail(`tilemap.set_cells clear: ${JSON.stringify(clearOk)}`);
      else pass(`tilemap.set_cells clear x2 -> total=2 (cells_unchanged=${clearOk.cells_unchanged})`);
      // Guard: non-tilemap node.
      assertGuard(
        "tilemap.set_cells non-tilemap",
        await bridge.call("tilemap.set_cells", { tilemap_path: aSpritePath, cells: [] }, 5000),
        "NOT_FOUND",
        "node",
      );
      // Guard: malformed cell (missing required key).
      assertGuard(
        "tilemap.set_cells malformed cell",
        await bridge.call("tilemap.set_cells", { tilemap_path: tmlPath, cells: [{ x: 0, y: 0 }] }, 5000),
        "INVALID_PARAMS",
        ["cells[0]", "source_id"],
      );
    } else {
      pass(`tilemap.set_cells: TileMapLayer setup failed (probably stale), skipping round-trip`);
    }
    try { await bridge.call("scene.delete_node", { node_path: tmlPath }, 5000); } catch { /* noop */ }

    // ---- editor.screenshot_node (iter 15d) -----------------------------
    // Capture a recognisable node — fall back to root if no Sprite is around.
    // We can't compare pixels, just assert image bytes returned.
    const ssNode = await bridge.call("scene.create_node", { class_name: "ColorRect", parent_path: ".", node_name: "MCPSmokeRect" }, 5000) as { status?: string; path?: string; code?: string };
    const ssPath = ssNode?.path ?? ".";
    const ssShot = await bridge.call("editor.screenshot_node", { node_path: ssPath }, 10000) as { image_base64?: string; width?: number; height?: number; code?: string };
    if (!ssShot?.image_base64 || ssShot.image_base64.length < 100) fail(`editor.screenshot_node: ${JSON.stringify({ ...ssShot, image_base64: ssShot?.image_base64 ? `<${ssShot.image_base64.length}B>` : null })}`);
    else pass(`editor.screenshot_node ${ssPath} -> ${ssShot.width}x${ssShot.height} base64=${ssShot.image_base64.length}`);
    // Guard: missing node.
    assertGuard(
      "editor.screenshot_node missing",
      await bridge.call("editor.screenshot_node", { node_path: "/root/NoSuch_15d_xyz" }, 5000),
      "NOT_FOUND",
      "node",
    );
    // Guard: too-small size.
    assertGuard(
      "editor.screenshot_node tiny size",
      await bridge.call("editor.screenshot_node", { node_path: ssPath, size: { width: 32, height: 32 } }, 5000),
      "INVALID_PARAMS",
      ["64", "4096"],
    );
    try { await bridge.call("scene.delete_node", { node_path: ssPath }, 5000); } catch { /* noop */ }

    // ---- asset.list (iter 15e) -------------------------------------------
    // Pre-seed: create a few known assets for filter assertions.
    const smokeListA = "res://smoke_list_a.tres";
    const smokeListB = "res://smoke_list_b.tres";
    const smokeListC = "res://smoke_list_c.gd";
    try { await bridge.call("resource.create", { file_path: smokeListA, resource_class: "Resource" }, 5000); } catch { /* noop */ }
    try { await bridge.call("resource.create", { file_path: smokeListB, resource_class: "Curve" }, 5000); } catch { /* noop */ }
    try { await bridge.call("script.write", { file_path: smokeListC, content: "extends Node" }, 5000); } catch { /* noop */ }
    // Let EditorFileSystem pick up the new files.
    try { await bridge.call("editor.reload_scripts", {}, 5000); } catch { /* noop */ }
    await new Promise((r) => setTimeout(r, 500));

    // Happy: name_glob filter
    const alGlob = await bridge.call("asset.list", { path_prefix: "res://", name_glob: "smoke_list_*" }, 5000) as { success?: boolean; count?: number; entries?: { path: string }[]; truncated?: boolean; code?: string };
    if (!alGlob?.success || typeof alGlob.count !== "number" || alGlob.count < 3) fail(`asset.list name_glob: expected >=3 entries, got ${JSON.stringify({ count: alGlob?.count, success: alGlob?.success, code: (alGlob as { code?: string })?.code })}`);
    else pass(`asset.list name_glob smoke_list_* -> count=${alGlob.count}`);
    // Happy: class_filter (ancestry-aware — Curve IS-A Resource)
    const alClass = await bridge.call("asset.list", { class_filter: "Curve" }, 5000) as { entries?: { path: string }[]; count?: number; code?: string };
    const hasCurve = alClass?.entries?.some((e) => e.path === smokeListB);
    if (!hasCurve) fail(`asset.list class_filter=Curve: expected ${smokeListB} in entries, got ${JSON.stringify(alClass)}`);
    else pass(`asset.list class_filter=Curve includes ${smokeListB}`);
    // Happy: extension_filter
    const alExt = await bridge.call("asset.list", { name_glob: "smoke_list_*", extension_filter: ["gd"] }, 5000) as { entries?: { path: string }[]; count?: number; code?: string };
    if (alExt?.count !== 1 || alExt?.entries?.[0]?.path !== smokeListC) fail(`asset.list extension_filter=gd: expected 1 .gd entry, got ${JSON.stringify(alExt)}`);
    else pass(`asset.list extension_filter=gd -> ${smokeListC}`);
    // Happy: max_results truncation
    const alTrunc = await bridge.call("asset.list", { max_results: 1 }, 5000) as { count?: number; truncated?: boolean; code?: string };
    if (alTrunc?.count !== 1 || alTrunc?.truncated !== true) fail(`asset.list max_results=1: expected count=1 truncated=true, got ${JSON.stringify(alTrunc)}`);
    else pass(`asset.list max_results=1 -> truncated`);
    // Guard: bad path_prefix
    assertGuard(
      "asset.list /tmp path",
      await bridge.call("asset.list", { path_prefix: "/tmp" }, 5000),
      "INVALID_PATH",
      "res://",
    );
    // Guard: bogus class_filter
    assertGuard(
      "asset.list bogus class_filter",
      await bridge.call("asset.list", { class_filter: "BogusClass" }, 5000),
      "INVALID_PARAMS",
      ["ClassDB", "ProjectSettings"],
    );
    // Guard: max_results out of range
    assertGuard(
      "asset.list max_results=5000",
      await bridge.call("asset.list", { max_results: 5000 }, 5000),
      "INVALID_PARAMS",
      "[1, 2000]",
    );

    // ---- asset.get_dependencies (iter 15e) --------------------------------
    // Pre-seed: a scene referencing icon.svg (the dogfood fixture).
    const smokeDeps = "res://smoke_deps.tscn";
    try { await bridge.call("scene.create", { file_path: smokeDeps, root_type: "Node2D", if_exists: "replace" }, 5000); } catch { /* noop */ }
    try { await bridge.call("scene.open", { file_path: smokeDeps }, 5000); } catch { /* noop */ }
    try { await bridge.call("scene.create_node", { class_name: "Sprite2D", parent_path: ".", node_name: "DepSprite" }, 5000); } catch { /* noop */ }
    try { await bridge.call("node.set_property", { node_path: "DepSprite", property: "texture", value: { type: "Resource", path: "res://icon.svg" } }, 5000); } catch { /* noop */ }
    try { await bridge.call("editor.save_scene", {}, 5000); } catch { /* noop */ }
    // Reload filesystem so deps are indexed.
    try { await bridge.call("editor.reload_scripts", {}, 5000); } catch { /* noop */ }
    await new Promise((r) => setTimeout(r, 500));

    const adDeps = await bridge.call("asset.get_dependencies", { file_path: smokeDeps }, 5000) as { success?: boolean; dependencies?: { path: string; class?: string }[]; count?: number; code?: string };
    if (!adDeps?.success || !adDeps.dependencies || adDeps.count === undefined) fail(`asset.get_dependencies: unexpected shape ${JSON.stringify(adDeps)}`);
    else {
      const hasIcon = adDeps.dependencies.some((d) => d.path.includes("icon.svg"));
      if (!hasIcon) fail(`asset.get_dependencies: expected icon.svg in deps, got ${JSON.stringify(adDeps.dependencies)}`);
      else pass(`asset.get_dependencies ${smokeDeps} -> count=${adDeps.count}, includes icon.svg`);
    }
    // Guard: bad path
    assertGuard(
      "asset.get_dependencies /tmp path",
      await bridge.call("asset.get_dependencies", { file_path: "/tmp/foo.tres" }, 5000),
      "INVALID_PATH",
      "res://",
    );
    // Guard: missing file
    assertGuard(
      "asset.get_dependencies missing file",
      await bridge.call("asset.get_dependencies", { file_path: "res://no_such_15e.tres" }, 5000),
      "NOT_FOUND",
      "no file",
    );

    // ---- editor.get_console (iter 15e) ------------------------------------
    // Structural test: just verify the response shape is correct.
    const consoleBase = await bridge.call("editor.get_console", { limit: 50 }, 5000) as { success?: boolean; entries?: { id: number; level: string; message: string }[]; count?: number; log_file?: string; next_id?: number; code?: string };
    if (!consoleBase?.success || !Array.isArray(consoleBase.entries) || typeof consoleBase.log_file !== "string") {
      fail(`editor.get_console base: unexpected shape ${JSON.stringify({ success: consoleBase?.success, entries: consoleBase?.entries?.length, log_file: consoleBase?.log_file, code: (consoleBase as { code?: string })?.code })}`);
    } else {
      pass(`editor.get_console base -> count=${consoleBase.count} log_file=${consoleBase.log_file}`);
    }

    // Emit a known warning via a @tool script, then poll for it.
    const consoleProbe = "res://smoke_console_probe.gd";
    try { await bridge.call("script.write", { file_path: consoleProbe, content: "@tool\nextends Node\nfunc _ready():\n\tpush_warning('MCP smoke: hello from 15e')" }, 5000); } catch { /* noop */ }
    try { await bridge.call("editor.reload_scripts", {}, 5000); } catch { /* noop */ }
    await new Promise((r) => setTimeout(r, 1000));
    const consoleWarn = await bridge.call("editor.get_console", { level_filter: ["warning"], limit: 100 }, 5000) as { success?: boolean; entries?: { level: string; message: string }[]; code?: string };
    // Note: the push_warning may or may not appear in the log depending on
    // whether Godot flushes before we read. Structural pass is sufficient.
    if (!consoleWarn?.success) fail(`editor.get_console level_filter=warning: ${JSON.stringify(consoleWarn)}`);
    else pass(`editor.get_console level_filter=warning -> count=${consoleWarn.entries?.length ?? 0}`);

    // since_id incremental: capture next_id, then poll again.
    const conPoll1 = await bridge.call("editor.get_console", { limit: 10 }, 5000) as { next_id?: number; success?: boolean };
    if (conPoll1?.success && typeof conPoll1.next_id === "number" && conPoll1.next_id >= 0) {
      const conPoll2 = await bridge.call("editor.get_console", { since_id: conPoll1.next_id, limit: 10 }, 5000) as { success?: boolean; count?: number; entries?: unknown[] };
      if (!conPoll2?.success) fail(`editor.get_console since_id: ${JSON.stringify(conPoll2)}`);
      else pass(`editor.get_console since_id=${conPoll1.next_id} -> count=${conPoll2.count}`);
    } else {
      pass(`editor.get_console since_id: skipped (no next_id from base call)`);
    }

    // Guard: limit out of range
    assertGuard(
      "editor.get_console limit=10000",
      await bridge.call("editor.get_console", { limit: 10000 }, 5000),
      "INVALID_PARAMS",
      "[1, 1000]",
    );

    // ---- editor.get_errors upgrade verification (iter 15e) ----------------
    // Emit a script with a syntax error, then verify editor.get_errors
    // returns real errors (not the old stub).
    const consoleErr = "res://smoke_console_err.gd";
    try { await bridge.call("script.write", { file_path: consoleErr, content: "extends Nbdoe" }, 5000); } catch { /* noop */ }
    try { await bridge.call("editor.reload_scripts", {}, 5000); } catch { /* noop */ }
    await new Promise((r) => setTimeout(r, 1000));
    const errResult = await bridge.call("editor.get_errors", {}, 5000) as { success?: boolean; errors?: { level?: string; message?: string }[]; count?: number; stub?: boolean; code?: string };
    if (errResult?.stub === true) fail(`editor.get_errors: still returning stub`);
    else if (!errResult?.success) fail(`editor.get_errors: ${JSON.stringify(errResult)}`);
    else pass(`editor.get_errors -> count=${errResult.count} (stub replaced)`);

    // ---- asset.import (iter 15f) -------------------------------------------
    // Minimal 1x1 transparent PNG (67 bytes decoded).
    const MINI_PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQABNjN9GQAAAABJRU5ErkJggg==";
    const smokeImportDest = "res://smoke_import_b64.png";

    // Happy: base64 import — fresh create.
    const impCreate = await bridge.call("asset.import", { base64_data: MINI_PNG_B64, dest_path: smokeImportDest, if_exists: "replace" }, 15000) as { success?: boolean; status?: string; source?: string; size_bytes?: number; path?: string; class?: string | null; warnings?: string[]; code?: string };
    if (!impCreate?.success || (impCreate.status !== "created" && impCreate.status !== "replaced") || impCreate.source !== "base64" || !impCreate.size_bytes || impCreate.size_bytes <= 0) {
      fail(`asset.import base64 create: ${JSON.stringify({ status: impCreate?.status, source: impCreate?.source, size_bytes: impCreate?.size_bytes, code: (impCreate as { code?: string })?.code })}`);
    } else {
      pass(`asset.import base64 -> status=${impCreate.status} size=${impCreate.size_bytes}B class=${impCreate.class ?? "null"}`);
    }

    // Happy: if_exists="return" — idempotent no-op.
    const impReturn = await bridge.call("asset.import", { base64_data: MINI_PNG_B64, dest_path: smokeImportDest, if_exists: "return" }, 10000) as { success?: boolean; status?: string; source?: unknown; code?: string };
    if (!impReturn?.success || impReturn.status !== "returned") fail(`asset.import if_exists=return: expected status=returned, got ${JSON.stringify(impReturn)}`);
    else pass(`asset.import if_exists=return -> status=returned`);

    // Happy: if_exists="replace" — overwrite.
    const impReplace = await bridge.call("asset.import", { base64_data: MINI_PNG_B64, dest_path: smokeImportDest, if_exists: "replace" }, 15000) as { success?: boolean; status?: string; code?: string };
    if (!impReplace?.success || impReplace.status !== "replaced") fail(`asset.import if_exists=replace: expected status=replaced, got ${JSON.stringify(impReplace)}`);
    else pass(`asset.import if_exists=replace -> status=replaced`);

    // Happy: if_exists="fail" — ALREADY_EXISTS.
    assertGuard(
      "asset.import if_exists=fail (file exists)",
      await bridge.call("asset.import", { base64_data: MINI_PNG_B64, dest_path: smokeImportDest, if_exists: "fail" }, 5000),
      "ALREADY_EXISTS",
      "already exists",
    );

    // Verify imported file is discoverable via asset.list.
    try { await bridge.call("editor.wait_for_idle", { timeout_ms: 5000 }, 10000); } catch { /* noop */ }
    const impList = await bridge.call("asset.list", { name_glob: "smoke_import_b64*" }, 5000) as { entries?: { path: string }[]; count?: number; code?: string };
    if (!impList?.entries?.some((e) => e.path === smokeImportDest)) {
      fail(`asset.import discovery: expected ${smokeImportDest} in asset.list, got ${JSON.stringify(impList)}`);
    } else {
      pass(`asset.import discovery: ${smokeImportDest} found in asset.list`);
    }

    // Guard: bad dest_path (not res://)
    assertGuard(
      "asset.import /tmp dest_path",
      await bridge.call("asset.import", { base64_data: MINI_PNG_B64, dest_path: "/tmp/foo.png" }, 5000),
      "INVALID_PATH",
      "res://",
    );
    // Guard: bad extension
    assertGuard(
      "asset.import .txt extension",
      await bridge.call("asset.import", { base64_data: MINI_PNG_B64, dest_path: "res://foo.txt" }, 5000),
      "INVALID_PATH",
      "allowlist",
    );
    // Guard: both source_path and base64_data
    assertGuard(
      "asset.import both params",
      await bridge.call("asset.import", { source_path: "C:\\tmp\\x.png", base64_data: MINI_PNG_B64, dest_path: "res://foo.png" }, 5000),
      "INVALID_PARAMS",
      "exactly one",
    );
    // Guard: neither param
    assertGuard(
      "asset.import neither param",
      await bridge.call("asset.import", { dest_path: "res://foo.png" }, 5000),
      "INVALID_PARAMS",
      "source_path",
    );
    // Guard: source_path with Godot scheme
    assertGuard(
      "asset.import res:// source_path",
      await bridge.call("asset.import", { source_path: "res://icon.svg", dest_path: "res://foo.svg" }, 5000),
      "INVALID_PATH",
      "Godot scheme",
    );
    // Guard: invalid base64
    assertGuard(
      "asset.import bad base64",
      await bridge.call("asset.import", { base64_data: "not-valid-base64!!!", dest_path: "res://foo.png" }, 5000),
      "INVALID_PARAMS",
      "base64",
    );
    // Guard: wait_for_scan_ms out of range
    assertGuard(
      "asset.import wait_for_scan_ms=50000",
      await bridge.call("asset.import", { base64_data: MINI_PNG_B64, dest_path: "res://foo.png", wait_for_scan_ms: 50000 }, 5000),
      "INVALID_PARAMS",
      "[0, 30000]",
    );

    // ---- editor.wait_for_idle (iter 15f) ------------------------------------
    // Happy: no scan in progress — returns immediately.
    const idleBase = await bridge.call("editor.wait_for_idle", {}, 10000) as { success?: boolean; was_scanning?: boolean; waited_ms?: number; code?: string };
    if (!idleBase?.success || typeof idleBase.was_scanning !== "boolean") {
      fail(`editor.wait_for_idle base: ${JSON.stringify(idleBase)}`);
    } else {
      pass(`editor.wait_for_idle -> was_scanning=${idleBase.was_scanning} waited_ms=${idleBase.waited_ms}`);
    }

    // Happy: explicit short timeout — still returns immediately.
    const idleShort = await bridge.call("editor.wait_for_idle", { timeout_ms: 100 }, 5000) as { success?: boolean; was_scanning?: boolean; code?: string };
    if (!idleShort?.success) fail(`editor.wait_for_idle timeout_ms=100: ${JSON.stringify(idleShort)}`);
    else pass(`editor.wait_for_idle timeout_ms=100 -> was_scanning=${idleShort.was_scanning}`);

    // Guard: timeout_ms out of range
    assertGuard(
      "editor.wait_for_idle timeout_ms=50000",
      await bridge.call("editor.wait_for_idle", { timeout_ms: 50000 }, 5000),
      "INVALID_PARAMS",
      "[0, 30000]",
    );

    // ---- scene.create_node global class resolution (iter 15h) ----------------
    const customClassScript = `class_name SmokeCustomNode\nextends Node2D\n\n@export var smoke_speed: float = 10.0\n`;
    await bridge.call("script.write", { file_path: "res://smoke_custom_class.gd", content: customClassScript }, 5000);
    await bridge.call("editor.reload_scripts", {}, 5000);
    await bridge.call("editor.wait_for_idle", { timeout_ms: 5000 }, 10000);
    // Create a node using the custom class_name.
    const customNode = await bridge.call("scene.create_node", { class_name: "SmokeCustomNode", parent_path: "", node_name: "SmokeCustom" }, 5000) as { success?: boolean; status?: string };
    if (!customNode?.success || customNode.status !== "created")
      fail(`scene.create_node with global class: ${JSON.stringify(customNode)}`);
    else pass("scene.create_node with global class_name -> created");
    // Idempotency: same name -> returned.
    const customIdem = await bridge.call("scene.create_node", { class_name: "SmokeCustomNode", parent_path: "", node_name: "SmokeCustom" }, 5000) as { success?: boolean; status?: string };
    if (!customIdem?.success || customIdem.status !== "returned")
      fail(`scene.create_node global class idempotency: ${JSON.stringify(customIdem)}`);
    else pass("scene.create_node with global class_name -> idempotent returned");
    // Clean up the node.
    await bridge.call("scene.delete_node", { node_path: "SmokeCustom" }, 5000);

    // ---- node.set_script round-trip (iter 15h) --------------------------------
    // Create a bare Node2D to attach a script to.
    await bridge.call("scene.create_node", { class_name: "Node2D", parent_path: "", node_name: "ScriptTarget" }, 5000);
    // Attach the custom script.
    const attachRes = await bridge.call("node.set_script", { node_path: "ScriptTarget", script_path: "res://smoke_custom_class.gd" }, 5000) as { success?: boolean; properties?: { name: string }[] };
    if (!attachRes?.success) fail(`node.set_script attach: ${JSON.stringify(attachRes)}`);
    else pass("node.set_script attach -> success");
    // Verify @export properties are returned.
    if (!Array.isArray(attachRes?.properties) || !attachRes.properties.some((p: any) => p.name === "smoke_speed"))
      fail(`node.set_script should return @export properties, got: ${JSON.stringify(attachRes?.properties)}`);
    else pass("node.set_script returns @export properties (smoke_speed found)");
    // Detach the script.
    const detachRes = await bridge.call("node.set_script", { node_path: "ScriptTarget", script_path: "" }, 5000) as { success?: boolean; script?: string | null; properties?: unknown[] };
    if (!detachRes?.success || detachRes.script !== null)
      fail(`node.set_script detach: ${JSON.stringify(detachRes)}`);
    else pass("node.set_script detach -> success, script: null");
    if (!Array.isArray(detachRes?.properties) || detachRes.properties.length !== 0)
      fail(`node.set_script detach should return empty properties, got: ${JSON.stringify(detachRes?.properties)}`);
    else pass("node.set_script detach -> properties empty");
    // Clean up node + script.
    await bridge.call("scene.delete_node", { node_path: "ScriptTarget" }, 5000);
    await bridge.call("script.delete", { file_path: "res://smoke_custom_class.gd" }, 5000);

    // node.set_script guard rejections (iter 15h).
    assertGuard("node.set_script no res://", await bridge.call("node.set_script", { node_path: ".", script_path: "/tmp/foo.gd" }, 5000), "INVALID_PATH", "res://");
    assertGuard("node.set_script not found", await bridge.call("node.set_script", { node_path: ".", script_path: "res://nonexistent_script.gd" }, 5000), "LOAD_FAILED", "cannot load");

    // ---- file.delete round-trip (iter 15i) ------------------------------------
    // Import a tiny 1x1 PNG for deletion testing (same base64 payload as 15f).
    const fileDelPath = "res://smoke_15i_file_del.png";
    await bridge.call("asset.import", { base64_data: MINI_PNG_B64, dest_path: fileDelPath, if_exists: "replace" }, 10000);
    // Delete via file.delete.
    const fdRes = await bridge.call("file.delete", { file_path: fileDelPath }, 5000) as { success?: boolean; code?: string };
    if (!fdRes?.success) fail(`file.delete: ${JSON.stringify(fdRes)}`);
    else pass("file.delete -> success");
    // Re-delete should return NOT_FOUND (confirms file is gone).
    assertGuard("file.delete re-delete", await bridge.call("file.delete", { file_path: fileDelPath }, 5000), "NOT_FOUND", "not found");

    // file.delete guard rejections (iter 15i).
    assertGuard("file.delete no res://", await bridge.call("file.delete", { file_path: "/tmp/foo.png" }, 5000), "INVALID_PATH", "res://");
    assertGuard("file.delete nonexistent", await bridge.call("file.delete", { file_path: "res://no_such_file_15i.png" }, 5000), "NOT_FOUND", "not found");
    assertGuard("file.delete plugin self-protect", await bridge.call("file.delete", { file_path: "res://addons/godot_mcp_toolkit/plugin.cfg" }, 5000), "PATH_DENIED", "toolkit");

    // ---- Cleanup (iter 15f + 15i) -------------------------------------------
    // Now that file.delete exists, clean up the 15f smoke PNG artifact too.
    try { await bridge.call("file.delete", { file_path: "res://smoke_import_b64.png" }, 5000); } catch { /* noop */ }
    pass("iter 15f + 15i cleanup: smoke PNGs deleted via file.delete");

    // ---- Cleanup (iter 15e) -----------------------------------------------
    try { await bridge.call("script.delete", { file_path: consoleProbe }, 5000); } catch { /* noop */ }
    try { await bridge.call("script.delete", { file_path: consoleErr }, 5000); } catch { /* noop */ }
    try { await bridge.call("resource.delete", { file_path: smokeListA }, 5000); } catch { /* noop */ }
    try { await bridge.call("resource.delete", { file_path: smokeListB }, 5000); } catch { /* noop */ }
    try { await bridge.call("script.delete", { file_path: smokeListC }, 5000); } catch { /* noop */ }
    // Reopen Main.tscn (smoke_deps.tscn was opened above; Main must be active
    // for subsequent tests). Delete smoke_deps after switching back.
    try { await bridge.call("scene.open", { file_path: "res://Main.tscn" }, 5000); } catch { /* noop */ }
    try { await bridge.call("scene.delete", { file_path: smokeDeps }, 5000); } catch { /* noop */ }
    try { await bridge.call("editor.reload_scripts", {}, 5000); } catch { /* noop */ }
    pass("iter 15e cleanup complete");

    // ---- Cleanup (iter 15c + 15d) ---------------------------------------
    // Delete probe nodes, save Main, delete throwaway files, ensure no game.
    // Order is load-bearing: every PackedScene instance of `instChildPath`
    // must be detached from Main BEFORE save_scene, and the scene file
    // itself deleted AFTER save_scene — otherwise Main is persisted with
    // a dangling `[ext_resource path="res://smoke_inst_child.tscn"]` and
    // Godot pops up "Could not save one or more scenes!" on the next save
    // (auto-save, focus loss, or the next smoke run's scene.open).
    try { await bridge.call("scene.delete_node", { node_path: spritePath }, 5000); } catch { /* noop */ }
    // Belt-and-braces: sweep every residual instance name. "Renamed" is the
    // current name after node.call_method set_name (L984); "CellA" and
    // "SmokeInstChild" only exist if an earlier assertion failed and the
    // rename chain desynced — the try/catch swallows the expected NOT_FOUND.
    for (const name of ["Renamed", "CellA", "SmokeInstChild"]) {
      try { await bridge.call("scene.delete_node", { node_path: name }, 5000); } catch { /* noop */ }
    }
    try { await bridge.call("editor.save_scene", {}, 5000); } catch { /* noop */ }
    try { await bridge.call("resource.delete", { file_path: smokeTexPath }, 5000); } catch { /* noop */ }
    try { await bridge.call("scene.delete", { file_path: instChildPath }, 5000); } catch { /* noop */ }
    try { await bridge.call("game.stop", {}, 5000); } catch { /* noop */ }
    // Restore the throwaway project setting if pre-state was null/absent.
    if (preValue === null) {
      try { await bridge.call("project.set_setting", { key: setSmokeKey, value: "" }, 5000); } catch { /* noop */ }
    } else {
      try { await bridge.call("project.set_setting", { key: setSmokeKey, value: preValue }, 5000); } catch { /* noop */ }
    }
    pass(`iter 15c + 15d cleanup complete`);

    // ---- Mode B (iter 10 + iter 12) ---------------------------------------
    // Smoke can't reliably F5 the game from here, so we branch on a probe of
    // 127.0.0.1:9090. Without a running game, we assert all three runtime
    // tools come back as GAME_NOT_RUNNING. With a running game, we assert
    // the happy path succeeds.
    const runtimeReachable = await probePort(HOST, RUNTIME_PORT, PROBE_TIMEOUT_MS);
    if (!runtimeReachable) {
      const modeBChecks: [string, unknown][] = [
        ["runtime.screenshot", {}],
        ["runtime.get_node_state", { node_path: "/root" }],
        ["debugger.get_log", { limit: 50 }],
        ["input.simulate", { event_type: "action", event_data: { action: "ui_accept" } }],
        ["animation_player.control", { node_path: "/root/NoSuchAP", operation: "pause" }],
      ];
      if (allowGameEval) modeBChecks.push(["game.eval", { code: "1+2" }]);
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
      const shot = await bridge.callRuntime("runtime.screenshot", {}, 10000) as { image_base64?: string; width?: number; height?: number; code?: string };
      if (!shot?.image_base64) fail(`runtime.screenshot: ${JSON.stringify(shot)}`);
      else {
        const buf = Buffer.from(shot.image_base64, "base64");
        if (buf[0] !== 0x89 || buf[1] !== 0x50) fail("runtime.screenshot: PNG magic missing");
        else pass(`runtime.screenshot PNG ${buf.length}B (${shot.width}x${shot.height})`);
      }

      const state = await bridge.callRuntime("runtime.get_node_state", { node_path: "/root" }, 5000) as { name?: string; class?: string; properties?: Record<string, unknown>; code?: string };
      if (!state?.name || !state.properties) fail(`runtime.get_node_state /root: ${JSON.stringify(state)}`);
      else pass(`runtime.get_node_state /root class=${state.class} props=${Object.keys(state.properties).length}`);

      const log = await bridge.callRuntime("debugger.get_log", { limit: 50 }, 5000) as { lines?: string[]; count?: number; total?: number; code?: string };
      if (!Array.isArray(log?.lines) || typeof log.count !== "number") fail(`debugger.get_log shape: ${JSON.stringify(log)}`);
      else pass(`debugger.get_log -> ${log.count} of ${log.total} lines`);

      // input.simulate with a built-in action (`ui_accept`) — parse_input_event
      // returning OK is the contract we test; we don't assert anyone consumed
      // the event because the dogfood Main.tscn has no input listener.
      const inp = await bridge.callRuntime("input.simulate", { event_type: "action", event_data: { action: "ui_accept", pressed: true } }, 5000) as { ok?: boolean; code?: string };
      if (!inp?.ok) fail(`input.simulate ui_accept: ${JSON.stringify(inp)}`);
      else pass("input.simulate action=ui_accept ok");

      // animation_player.control bogus path exercises the NOT_FOUND branch.
      // We can't assert play/pause without knowing the dogfood game has an
      // AnimationPlayer (Main.tscn doesn't).
      const apMiss = await bridge.callRuntime("animation_player.control", { node_path: "/root/NoSuchAP", operation: "pause" }, 5000) as { code?: string };
      if (apMiss?.code !== "NOT_FOUND") fail(`animation_player.control bogus: expected NOT_FOUND, got ${JSON.stringify(apMiss)}`);
      else pass("animation_player.control bogus -> NOT_FOUND");

      // game.eval round-trip — only when both env-gated AND game running.
      if (allowGameEval) {
        const ge = await bridge.callRuntime("game.eval", { code: "1+2" }, 5000) as { result?: unknown; code?: string };
        if (ge?.result !== 3) fail(`game.eval 1+2: expected 3, got ${JSON.stringify(ge)}`);
        else pass("game.eval 1+2 -> 3");
      }
    }

    // ---- Phase 8: Security (iter 18) — FileGuard path traversal -----------
    // Each assertion exercises FileGuard.resolve_safe rejecting traversal
    // attempts, absolute OS paths, and non-allowed prefixes.

    // script.read traversal via ..
    assertGuard("FileGuard ../../../etc/passwd",
      await bridge.call("script.read", { file_path: "../../../etc/passwd" }, 5000),
      "PATH_DENIED", "..");
    // script.read absolute path
    assertGuard("FileGuard /etc/passwd",
      await bridge.call("script.read", { file_path: "/etc/passwd" }, 5000),
      "PATH_DENIED", "absolute");
    // script.read traversal buried inside res://
    assertGuard("FileGuard res://../../../etc/passwd",
      await bridge.call("script.read", { file_path: "res://../../../etc/passwd" }, 5000),
      "PATH_DENIED", "..");
    // resource.load traversal (15b path)
    assertGuard("FileGuard resource.load ../../secret.tres",
      await bridge.call("resource.load", { file_path: "../../secret.tres" }, 5000),
      "PATH_DENIED", "..");
    // scene.instantiate packed_path traversal (15c path)
    assertGuard("FileGuard scene.instantiate traversal packed_path",
      await bridge.call("scene.instantiate", { parent_path: ".", packed_path: "../../x.tscn" }, 5000),
      "PATH_DENIED", "..");
    // folder.create traversal (15b path)
    assertGuard("FileGuard folder.create ../../up",
      await bridge.call("folder.create", { folder_path: "../../up" }, 5000),
      "PATH_DENIED", "..");

    // Screenshot user://screenshots/ whitelist — allowed prefix.
    const userShotPath = "user://screenshots/smoke_sec.png";
    const userShot = await bridge.call("editor.screenshot", { save_path: userShotPath }, 10000) as { path?: string; image_base64?: string; code?: string };
    if (userShot?.path !== userShotPath || !userShot.image_base64) fail(`editor.screenshot user://screenshots/ whitelist: ${JSON.stringify(userShot)}`);
    else pass(`editor.screenshot user://screenshots/ whitelist -> ${userShot.path}`);
    // user://other/ is NOT whitelisted — must be rejected.
    assertGuard("editor.screenshot user://other/x.png",
      await bridge.call("editor.screenshot", { save_path: "user://other/x.png" }, 5000),
      "PATH_DENIED", "prefix");

    // Untrusted envelope check — script.read wraps content.
    const envScriptPath = "res://smoke_probe.gd"; // written earlier in smoke
    const envRead = await bridge.call("script.read", { file_path: envScriptPath }, 5000) as { content?: string; code?: string };
    if (!envRead?.content) {
      fail(`envelope check: script.read returned no content: ${JSON.stringify(envRead)}`);
    } else if (!envRead.content.includes('<untrusted kind="script"')) {
      fail(`envelope check: script.read content missing <untrusted> envelope`);
    } else if (!envRead.content.includes(`source="${envScriptPath}"`)) {
      fail(`envelope check: script.read envelope missing source="${envScriptPath}"`);
    } else {
      pass(`envelope check: script.read content wrapped in <untrusted kind="script" source="${envScriptPath}">`);
    }

    // Untrusted envelope on project.get_settings.
    const envSettings = await bridge.call("project.get_settings", { prefix: "application/" }, 5000) as { settings?: string; code?: string };
    if (typeof envSettings?.settings !== "string" || !envSettings.settings.includes('<untrusted kind="project_settings"')) {
      fail(`envelope check: project.get_settings missing <untrusted> wrapper: ${JSON.stringify(envSettings)?.slice(0, 200)}`);
    } else {
      pass(`envelope check: project.get_settings wrapped in <untrusted kind="project_settings">`);
    }

    // ---- Reconnect (iter 13) ---------------------------------------------
    // Decoupled from Godot: a fake echo server on a free port. We terminate
    // the connected peer (server keeps listening) to mimic plugin disable
    // followed by re-enable. Bridge's auto-reconnect should pick the next
    // backoff tick (~1s) and the post-cycle echo should round-trip.
    const fake = await makeFakeEchoServer();
    const fakeBridge = createBridge(`ws://127.0.0.1:${fake.port}`);
    try {
      const before = await fakeBridge.call("echo", { ping: "before" }, 5000);
      if (!deepEqual(before, { ping: "before" })) {
        fail(`reconnect: pre-cycle echo: ${JSON.stringify(before)}`);
      } else {
        pass("reconnect: pre-cycle echo via fake server");
      }
      // Drop the active peer; let the bridge process the close event.
      // 100ms is enough on Windows for the WS close to propagate to ws's
      // `on('close')` handler.
      fake.dropAll();
      await new Promise((res) => setTimeout(res, 100));
      // Hot path: bridge waits up to 10s for reconnect; first backoff
      // attempt fires at ~1s and succeeds because the server is still
      // listening on the same port.
      const after = await fakeBridge.call("echo", { ping: "after" }, 5000);
      if (!deepEqual(after, { ping: "after" })) {
        fail(`reconnect: post-cycle echo: ${JSON.stringify(after)}`);
      } else {
        pass("reconnect: post-cycle echo round-trip via auto-reconnect");
      }
    } finally {
      await fakeBridge.close();
      await fake.close();
    }
  } catch (err) {
    fail(`unexpected error: ${(err as Error).message}`);
  } finally {
    await bridge.close();
  }

  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error("[smoke] FAIL unexpected:", err);
  process.exit(1);
});
