import net from "node:net";
import { WebSocketServer, WebSocket as WS } from "ws";
import type { AddressInfo } from "node:net";

import { createBridge } from "../src/transport/bridge.js";
import { isVersionAtLeast, type GodotVer } from "../src/shared/version.js";

// ─── Constants ───────────────────────────────────────────────────────────
export const HOST = "127.0.0.1";
export const PORT = Number(process.env.GODOT_MCP_PORT ?? "6550");
export const RUNTIME_PORT = Number(process.env.GODOT_MCP_RUNTIME_PORT ?? "6570");
export const PROBE_TIMEOUT_MS = 1000;
export const MAIN_SCENE = "res://Main.tscn";
export const CALL_TIMEOUT = 5000;
export const SCREENSHOT_TIMEOUT = 10000;
export const IMPORT_TIMEOUT = 15000;

// ─── Version-aware node classes ────────────────────────────────────────────

/**
 * The tilemap node class for the running Godot version: `TileMapLayer` on 4.3+, legacy
 * `TileMap` on 4.2 (TileMapLayer doesn't exist there). Centralizes the single 4.2-vs-4.3+
 * tilemap branch so smoke sections exercise each version's native node type — the tilemap
 * tools handle both (41m-ter A1). Pass `bridge.getGodotVersion()`.
 */
export function tilemapNodeClass(godotVer: GodotVer | undefined): "TileMapLayer" | "TileMap" {
  return godotVer != null && isVersionAtLeast(godotVer, "4.3") ? "TileMapLayer" : "TileMap";
}

// ─── Bridge type alias ──────────────────────────────────────────────────
export type BridgeInstance =
  ReturnType<typeof createBridge> extends Promise<infer T> ? T : ReturnType<typeof createBridge>;

// ─── Test context ────────────────────────────────────────────────────────
// Passed to every test section. `fail` sets a flag that main() reads at exit.
export type TestCtx = {
  bridge: BridgeInstance;
  pass: (msg: string) => void;
  fail: (msg: string) => void;
  projectPath?: string;
};

// ─── Assertion helpers ───────────────────────────────────────────────────

/** Assert a guard rejection: {success:false, code, error containing mustInclude}. */
export function assertGuard(
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

/**
 * Assert that a result carries a non-empty hint containing mustInclude.
 * Checks the dedicated `hint` field first; if absent, falls back to
 * searching inside the `error` string (some tools embed guidance there).
 * Logs actual hint/error on failure for easy debugging.
 */
export function assertHint(ctx: TestCtx, label: string, result: unknown, mustInclude?: string): void {
  const r = result as { hint?: string; error?: string };
  const hintSource = typeof r?.hint === "string" && r.hint.length > 0 ? r.hint : undefined;
  const errorSource = typeof r?.error === "string" && r.error.length > 0 ? r.error : undefined;
  const searchIn = hintSource ?? errorSource;

  if (!searchIn) {
    ctx.fail(
      `${label}: expected non-empty hint (or error with guidance), got hint=${JSON.stringify(r?.hint)}, error=${JSON.stringify(r?.error)}`,
    );
  } else if (mustInclude && !searchIn.includes(mustInclude)) {
    ctx.fail(`${label}: hint/error missing "${mustInclude}" in "${searchIn}"`);
  } else {
    const source = hintSource ? "hint" : "error";
    ctx.pass(`${label} -> ${source} contains guidance`);
  }
}

/** Assert an error envelope: {success:false, code, error:string}. */
export function assertError(ctx: TestCtx, label: string, result: unknown, code: string): void {
  const r = result as { success?: boolean; error?: string; code?: string };
  if (!r || r.success !== false || r.code !== code || typeof r.error !== "string") {
    ctx.fail(`${label}: expected {success:false, code:'${code}', error:string}, got ${JSON.stringify(result)}`);
  } else {
    ctx.pass(`${label} -> ${code}`);
  }
}

/**
 * Strip an `<untrusted>` security envelope if present. Returns the inner
 * content — JSON-parsed if valid JSON, raw string otherwise. Passes
 * non-string values through unchanged.
 */
export function unwrapUntrusted(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const match = value.match(/^<untrusted(?:-[0-9a-f]+)?[^>]*>\n?([\s\S]*?)\n?<\/untrusted(?:-[0-9a-f]+)?>$/);
  if (!match) return value;
  try {
    return JSON.parse(match[1]);
  } catch {
    return match[1];
  }
}

// ─── Standalone helpers ──────────────────────────────────────────────────

export async function probePort(host: string, port: number, timeoutMs: number): Promise<boolean> {
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

// `label` drives the log prefix and the re-run hint so the shared harness can
// say "npm run flows" when the flow suite is what hit the closed port. Defaults
// keep every existing caller (smoke, eval, csharp-audit) byte-identical.
export function printUnreachable(label = "smoke"): void {
  console.error(`[${label}] ERROR: nothing listening on ${HOST}:${PORT}.

The Godot toolkit editor must be running with the plugin enabled:
  1. Open the toolkit repo (see memory/reference_repo_paths.md §2) in Godot 4.x
  2. Project -> Project Settings -> Plugins -> "Godot MCP Toolkit" -> Active
  3. Re-run \`npm run ${label}\`.

The ${label} suite does not launch Godot; it only verifies the plugin is reachable.`);
}

// Fake echo server for the iter-13 reconnect smoke. Echoes JSON-RPC
// `echo` calls back with their params as result; tracks active peers so
// `dropAll()` can simulate a plugin disable/re-enable without taking the
// listener down (avoids same-port bind race after wss.close).
export async function makeFakeEchoServer(): Promise<{ port: number; dropAll: () => void; close: () => Promise<void> }> {
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>((res) => wss.once("listening", () => res()));
  const sockets = new Set<WS>();
  wss.on("connection", (sock) => {
    sockets.add(sock);
    sock.on("close", () => sockets.delete(sock));
    sock.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString()) as { auth?: unknown; id?: unknown; method?: string; params?: unknown };
        // Accept any auth handshake so the bridge's token-auth completes.
        if (msg.auth !== undefined) {
          sock.send(JSON.stringify({ authed: true }));
          return;
        }
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

export function deepEqual(a: unknown, b: unknown): boolean {
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
