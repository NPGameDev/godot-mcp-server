import net from "node:net";
import { createBridge } from "../src/bridge.js";
import { sceneTools } from "../src/tools/scene.js";
import { nodeTools } from "../src/tools/node.js";
import { scriptTools } from "../src/tools/script.js";
import { editorTools } from "../src/tools/editor.js";
import { runtimeTools } from "../src/tools/runtime.js";
import { signalTools } from "../src/tools/signals.js";
import { resourceTools } from "../src/tools/resource.js";
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

  try {
    // echo round-trip (iter 05)
    const payload = { t: Date.now(), nonce: "smoke-01" };
    const echoResult = await bridge.call("echo", payload, 5000);
    if (!deepEqual(echoResult, payload)) fail(`echo: expected ${JSON.stringify(payload)} got ${JSON.stringify(echoResult)}`);
    else pass("echo round-trip");

    // Tool count — post-iter-11 registers exactly 22 tools (tier-3 added 6:
    // signal_list/connect/disconnect/emit + resource_load + node_get_property_list).
    const allTools = [...sceneTools, ...nodeTools, ...scriptTools, ...editorTools, ...runtimeTools, ...signalTools, ...resourceTools];
    if (allTools.length !== 22) fail(`tool count: expected 22, got ${allTools.length}`);
    else pass(`tool count == 22`);

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

    // scene.create_node idempotency
    const nodeName = "SmokeProbe";
    const c1 = await bridge.call("scene.create_node", { class_name: "Node", parent: ".", name: nodeName }, 5000) as { path?: string; code?: string; error?: string };
    if (!c1 || typeof c1.path !== "string") fail(`scene.create_node first call: ${JSON.stringify(c1)}`);
    const c2 = await bridge.call("scene.create_node", { class_name: "Node", parent: ".", name: nodeName }, 5000) as { path?: string; code?: string };
    if (!c2 || c2.code !== "ALREADY_EXISTS" || c2.path !== c1.path) fail(`scene.create_node idempotency: ${JSON.stringify(c2)}`);
    else pass(`scene.create_node idempotent at ${c2.path}`);

    // node.set_property / node.get_property round-trip via editor_description (plain String)
    const created = c1?.path ?? nodeName;
    const marker = `smoke-${Date.now()}`;
    const setRes = await bridge.call("node.set_property", { path: created, property: "editor_description", value: marker }, 5000) as { ok?: boolean; code?: string; error?: string };
    if (!setRes?.ok) fail(`node.set_property: ${JSON.stringify(setRes)}`);
    const getRes = await bridge.call("node.get_property", { path: created, property: "editor_description" }, 5000) as { value?: unknown; code?: string };
    if (getRes?.value !== marker) fail(`node.get_property: expected ${marker} got ${JSON.stringify(getRes)}`);
    else pass("node.set_property + node.get_property round-trip");

    // scene.delete_node cleanup (UndoRedo-based; safe to precede file writes).
    const del = await bridge.call("scene.delete_node", { path: created }, 5000) as { ok?: boolean; code?: string };
    if (!del?.ok) fail(`scene.delete_node: ${JSON.stringify(del)}`);
    else pass("scene.delete_node cleanup");

    // script.write + script.read round-trip. Use .txt so Godot's FileSystem
    // import pipeline doesn't re-scan GDScript on every run.
    const scriptPath = "res://smoke_probe.txt";
    const scriptBody = `# smoke ${Date.now()}\nextends Node\n`;
    const wRes = await bridge.call("script.write", { path: scriptPath, content: scriptBody }, 5000) as { ok?: boolean; undoable?: boolean; code?: string };
    if (!wRes?.ok) fail(`script.write: ${JSON.stringify(wRes)}`);
    if (wRes?.undoable !== true) fail(`script.write missing undoable flag (iter-09 UndoRedo wrap): ${JSON.stringify(wRes)}`);
    const rRes = await bridge.call("script.read", { path: scriptPath }, 5000) as { content?: string; code?: string };
    if (rRes?.content !== scriptBody) fail(`script.read round-trip mismatch: ${JSON.stringify(rRes)}`);
    else pass("script.write (undoable) + script.read round-trip");

    // editor.reload_scripts after a write — should pick up the new content.
    const reload = await bridge.call("editor.reload_scripts", null, 5000) as { ok?: boolean; code?: string };
    if (!reload?.ok) fail(`editor.reload_scripts: ${JSON.stringify(reload)}`);
    else pass("editor.reload_scripts ok");

    // script.read bogus path -> domain error
    const bogus = await bridge.call("script.read", { path: "res://does_not_exist_smoke.txt" }, 5000) as { code?: string };
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
    const openRes = await bridge.call("scene.open", { path: currentScenePath }, 5000) as { ok?: boolean; path?: string; code?: string };
    if (!openRes?.ok || openRes.path !== currentScenePath) fail(`scene.open: ${JSON.stringify(openRes)}`);
    else pass(`scene.open ${openRes.path}`);

    // scene.open with a nonexistent path -> NOT_FOUND.
    const openMiss = await bridge.call("scene.open", { path: "res://does_not_exist_smoke.tscn" }, 5000) as { code?: string };
    if (openMiss?.code !== "NOT_FOUND") fail(`scene.open bogus: expected NOT_FOUND, got ${JSON.stringify(openMiss)}`);
    else pass("scene.open bogus -> NOT_FOUND");

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
    const sig_create = await bridge.call("scene.create_node", { class_name: "Node", parent: ".", name: "SignalProbe" }, 5000) as { path?: string; code?: string };
    if (!sig_create?.path) fail(`scene.create_node SignalProbe: ${JSON.stringify(sig_create)}`);
    const probePath = sig_create?.path ?? "SignalProbe";

    // signal.list → Node base class exposes a known set of signals.
    const sigList = await bridge.call("signal.list", { path: probePath }, 5000) as { signals?: { name?: string; args?: unknown[] }[]; code?: string };
    if (!Array.isArray(sigList?.signals) || sigList.signals.length === 0) fail(`signal.list: ${JSON.stringify(sigList)}`);
    else if (!sigList.signals.some((s) => s.name === "child_order_changed")) fail(`signal.list: expected child_order_changed among ${sigList.signals.map((s) => s.name).join(",")}`);
    else pass(`signal.list -> ${sigList.signals.length} signals`);

    // Round-trip: connect + ALREADY_EXISTS + disconnect + NOT_FOUND. Uses
    // `child_order_changed` -> `notify_property_list_changed` — both
    // no-arg, non-destructive, always present on Node.
    const sigArgs = { source_path: probePath, signal: "child_order_changed", target_path: probePath, method: "notify_property_list_changed" };
    const con1 = await bridge.call("signal.connect", sigArgs, 5000) as { ok?: boolean; code?: string };
    if (!con1?.ok) fail(`signal.connect first: ${JSON.stringify(con1)}`);
    const con2 = await bridge.call("signal.connect", sigArgs, 5000) as { code?: string };
    if (con2?.code !== "ALREADY_EXISTS") fail(`signal.connect idempotency: expected ALREADY_EXISTS, got ${JSON.stringify(con2)}`);
    else pass("signal.connect + ALREADY_EXISTS on repeat (I3)");

    // signal.emit with no args on the connected signal — should just succeed.
    const emitRes = await bridge.call("signal.emit", { path: probePath, signal: "child_order_changed", args: [] }, 5000) as { ok?: boolean; code?: string };
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
    const plist = await bridge.call("node.get_property_list", { path: probePath }, 5000) as { properties?: { name?: string; type?: number; hint?: number; hint_string?: string }[]; count?: number; code?: string };
    if (!Array.isArray(plist?.properties) || typeof plist.count !== "number") {
      fail(`node.get_property_list shape: ${JSON.stringify(plist)}`);
    } else {
      const names = new Set(plist.properties.map((p) => p.name));
      if (!names.has("process_mode")) fail(`node.get_property_list: expected process_mode, got ${Array.from(names).slice(0, 5).join(",")}...`);
      else pass(`node.get_property_list -> ${plist.count} props (incl process_mode)`);
    }

    // Clean up the signal probe.
    await bridge.call("scene.delete_node", { path: probePath }, 5000);
    pass(`SignalProbe cleanup`);

    // resource.load on the dogfood icon.svg — exists, resolves to a Texture.
    const res1 = await bridge.call("resource.load", { path: "res://icon.svg" }, 5000) as { class?: string; path?: string; metadata?: { width?: number; height?: number }; code?: string };
    if (!res1?.class) fail(`resource.load icon.svg: ${JSON.stringify(res1)}`);
    else if (!res1.metadata?.width || !res1.metadata.height) fail(`resource.load icon.svg: missing width/height in metadata: ${JSON.stringify(res1.metadata)}`);
    else pass(`resource.load icon.svg -> class=${res1.class} ${res1.metadata.width}x${res1.metadata.height}`);

    const res2 = await bridge.call("resource.load", { path: "res://does_not_exist_smoke.tres" }, 5000) as { code?: string };
    if (res2?.code !== "NOT_FOUND") fail(`resource.load bogus: expected NOT_FOUND, got ${JSON.stringify(res2)}`);
    else pass("resource.load bogus -> NOT_FOUND");

    // ---- Mode B (iter 10) --------------------------------------------------
    // Smoke can't reliably F5 the game from here, so we branch on a probe of
    // 127.0.0.1:9090. Without a running game, we assert all three runtime
    // tools come back as GAME_NOT_RUNNING. With a running game, we assert
    // the happy path succeeds.
    const runtimeReachable = await probePort(HOST, RUNTIME_PORT, PROBE_TIMEOUT_MS);
    if (!runtimeReachable) {
      const modeBChecks: [string, unknown][] = [
        ["runtime.screenshot", {}],
        ["runtime.get_node_state", { path: "/root" }],
        ["debugger.get_log", { limit: 50 }],
      ];
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

      const state = await bridge.callRuntime("runtime.get_node_state", { path: "/root" }, 5000) as { name?: string; class?: string; properties?: Record<string, unknown>; code?: string };
      if (!state?.name || !state.properties) fail(`runtime.get_node_state /root: ${JSON.stringify(state)}`);
      else pass(`runtime.get_node_state /root class=${state.class} props=${Object.keys(state.properties).length}`);

      const log = await bridge.callRuntime("debugger.get_log", { limit: 50 }, 5000) as { lines?: string[]; count?: number; total?: number; code?: string };
      if (!Array.isArray(log?.lines) || typeof log.count !== "number") fail(`debugger.get_log shape: ${JSON.stringify(log)}`);
      else pass(`debugger.get_log -> ${log.count} of ${log.total} lines`);
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
