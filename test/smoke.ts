import net from "node:net";
import { createBridge } from "../src/bridge.js";

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
  try {
    const payload = { t: Date.now(), nonce: "smoke-01" };
    const result = await bridge.call("echo", payload, 5000);
    if (!deepEqual(result, payload)) {
      console.error("[smoke] FAIL echo: expected", payload, "got", result);
      failed = true;
    } else {
      console.log("[smoke] PASS echo round-trip", payload);
    }
  } catch (err) {
    console.error("[smoke] FAIL echo (error):", (err as Error).message);
    failed = true;
  } finally {
    await bridge.close();
  }

  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error("[smoke] FAIL unexpected:", err);
  process.exit(1);
});
