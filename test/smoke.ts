import net from "node:net";
import { createBridge } from "../src/bridge.js";
import { sceneTools } from "../src/tools/scene.js";
import { nodeTools } from "../src/tools/node.js";
import { scriptTools } from "../src/tools/script.js";
import { editorTools } from "../src/tools/editor.js";

const HOST = "127.0.0.1";
const PORT = Number(process.env.GODOT_MCP_PORT ?? "6505");
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

  const bridge = createBridge(`ws://${HOST}:${PORT}`);
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

    // Tool count — post-iter-09 registers exactly 13 tools (tier-1 added 3).
    const allTools = [...sceneTools, ...nodeTools, ...scriptTools, ...editorTools];
    if (allTools.length !== 13) fail(`tool count: expected 13, got ${allTools.length}`);
    else pass(`tool count == 13`);

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
