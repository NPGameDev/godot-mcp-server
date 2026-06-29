/**
 * Deterministic unit tests for the onGodotVersionKnown bridge primitive
 * The composition root registers a one-shot-friendly hook that
 * fires when the connected Godot version resolves (unknown → known) so it can
 * complete a tool surface registered before the editor reported its version
 * (version-gated tools + extension tools on a server-before-editor cold start).
 *
 * These tests pin the contract the startup reconcile relies on:
 *   1. fires EXACTLY ONCE on the unknown → known transition (auth-resolved),
 *   2. does NOT fire when the version was pre-populated from the registry
 *      (already known at createBridge → no transition),
 *   3. does NOT re-fire on a later re-auth that re-delivers the same version
 *      (reconnect = known → known, not a transition).
 *
 * Wire contract: the toolkit reports its engine version in the auth response's
 * `godot_version` field (snake_case) and its own version in `version` — see
 * authenticate() in bridge.ts. (bridge-notifications.test.ts sends `godotVersion`,
 * a dead field there because those tests never exercise version delivery.)
 */

import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { WebSocketServer, WebSocket as WS } from "ws";
import type { AddressInfo } from "node:net";
import { normalizePath, registryPath, type RegistryEntry } from "../../src/registry.js";

// ── Hermetic environment (token + registry redirect) ─────────────────
// One temp dir holds the auth token AND (via the APPDATA/XDG_DATA_HOME redirect
// that registryPath() honors) the projects.json registry. GODOT_MCP_TOKEN_PATH
// is the operator override readToken reads directly, so auth works
// regardless of the redirected registry. darwin hardcodes ~/Library with no
// override, so the registry-seeding case (test 2) is skipped there — matching
// registry.test.ts. The runner isolates each file in its own subprocess, so
// these module-scope env mutations don't leak.
const REDIRECT: string | null =
  process.platform === "win32" ? "APPDATA" : process.platform === "linux" ? "XDG_DATA_HOME" : null;

const tmpDir = mkdtempSync(join(tmpdir(), "mcp-vhook-"));
const tokenPath = join(tmpDir, "mcp_token");
writeFileSync(tokenPath, "test-token-for-unit-tests");
process.env.GODOT_MCP_TOKEN_PATH = tokenPath;
if (REDIRECT) process.env[REDIRECT] = tmpDir;

const { createBridge } = await import("../../src/transport/bridge.js");

// ── Registry seeding helpers (no-op on darwin) ───────────────────────

/** Build a complete RegistryEntry, overriding only what a case cares about. */
function makeEntry(over: Partial<RegistryEntry>): RegistryEntry {
  return {
    port: 6550,
    token_path: "tok",
    pid: process.pid,
    started_at: 1000,
    runtime_port: null,
    runtime_pid: null,
    ...over,
  };
}

/** Write projects.json under the redirected registry root. No-op on darwin. */
function writeRegistry(byPath: Record<string, RegistryEntry>): void {
  if (!REDIRECT) return;
  mkdirSync(dirname(registryPath()), { recursive: true });
  writeFileSync(registryPath(), JSON.stringify({ by_path: byPath }));
}

// Start with an empty registry so createBridge pre-populates nothing unless a
// case explicitly seeds an entry.
writeRegistry({});

// ── Mock editor WebSocket server ─────────────────────────────────────

interface MockServer {
  port: number;
  /** How many auth handshakes the server has answered (1 per connect/reconnect). */
  authCount: () => number;
  /** Forcibly terminate every connected client → drives a bridge reconnect. */
  dropClients: () => void;
  close: () => Promise<void>;
}

/**
 * A minimal editor stand-in. Answers the auth handshake with the supplied Godot
 * version in the `godot_version` field, and echoes a benign success for any RPC.
 * Pass godotVersion=null to simulate a pre-handshake toolkit that reports none.
 */
function makeMockServer(godotVersion: string | null = "4.5"): Promise<MockServer> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    const sockets = new Set<WS>();
    let auths = 0;
    wss.on("listening", () => {
      resolve({
        port: (wss.address() as AddressInfo).port,
        authCount: () => auths,
        dropClients: () => {
          for (const s of sockets) s.terminate();
        },
        close: () =>
          new Promise<void>((res) => {
            for (const s of sockets) s.terminate();
            wss.close(() => res());
          }),
      });
    });
    wss.on("connection", (sock) => {
      sockets.add(sock);
      sock.on("close", () => sockets.delete(sock));
      sock.on("message", (data) => {
        let msg: { auth?: unknown; id?: unknown };
        try {
          msg = JSON.parse(data.toString()) as { auth?: unknown; id?: unknown };
        } catch {
          return;
        }
        if (msg.auth !== undefined) {
          auths++;
          const resp: Record<string, unknown> = { authed: true, version: "1.0.0" };
          if (godotVersion != null) resp.godot_version = godotVersion;
          sock.send(JSON.stringify(resp));
          return;
        }
        if (msg.id != null) sock.send(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { ok: true } }));
      });
    });
  });
}

/** Wait for real I/O (microtasks + next event loop tick). */
function ioFlush(): Promise<void> {
  return new Promise((r) => setImmediate(r));
}

/** Poll a condition until true or the deadline elapses (real timers keep the
 *  loop alive so the bridge's unref'd reconnect timer can fire). */
async function waitFor(cond: () => boolean, label: string, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error(`waitFor timed out: ${label}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

// ── Test 1: fires exactly once on the unknown → known transition ─────

async function testFiresOnceOnTransition() {
  const server = await makeMockServer("4.5");
  const bridge = createBridge(`ws://127.0.0.1:${server.port}`, {
    projectPath: "/__godot_mcp_unit_test__/version-hook-transition",
    explicitEditorPort: true,
  });
  let count = 0;
  bridge.onGodotVersionKnown(() => {
    count++;
  });

  try {
    // No registry entry for this path → version genuinely unknown pre-auth.
    assert.equal(bridge.getGodotVersion(), undefined, "version is unknown before auth");

    // Warmup forces connect + auth, which resolves the version → transition.
    await bridge.call("warmup", {}, 5000);
    await ioFlush();

    assert.equal(count, 1, "hook fires exactly once on unknown → known");
    assert.deepEqual(bridge.getGodotVersion(), [4, 5], "version resolved to 4.5 after auth");
    console.log("  PASS: onGodotVersionKnown fires once on the unknown → known transition");
  } finally {
    await bridge.close();
    await server.close();
  }
}

// ── Test 2: does NOT fire when pre-populated from the registry ────────

async function testNoFireWhenPrePopulated() {
  if (!REDIRECT) {
    console.log("  SKIP (darwin: no registry path override): pre-populated case");
    return;
  }
  const projectPath = "/__godot_mcp_unit_test__/version-hook-prepop";
  writeRegistry({ [normalizePath(projectPath)]: makeEntry({ godot_version: "4.5" }) });
  const server = await makeMockServer("4.5");
  const bridge = createBridge(`ws://127.0.0.1:${server.port}`, {
    projectPath,
    explicitEditorPort: true,
  });
  let count = 0;
  bridge.onGodotVersionKnown(() => {
    count++;
  });

  try {
    // Pre-populated from the registry → already known at createBridge.
    assert.deepEqual(bridge.getGodotVersion(), [4, 5], "version pre-populated from registry at createBridge");

    // Auth re-delivers the same "4.5" — known → known, so NO transition.
    await bridge.call("warmup", {}, 5000);
    await ioFlush();

    assert.equal(count, 0, "hook must NOT fire when version was already known at createBridge");
    console.log("  PASS: onGodotVersionKnown does NOT fire when pre-populated from the registry");
  } finally {
    await bridge.close();
    await server.close();
    writeRegistry({}); // restore empty for any later case
  }
}

// ── Test 3: does NOT re-fire on a reconnect re-auth ──────────────────

async function testNoRefireOnReconnect() {
  const server = await makeMockServer("4.5");
  const bridge = createBridge(`ws://127.0.0.1:${server.port}`, {
    projectPath: "/__godot_mcp_unit_test__/version-hook-reconnect",
    explicitEditorPort: true,
  });
  let count = 0;
  bridge.onGodotVersionKnown(() => {
    count++;
  });
  // Count reconnect-sourced config_reloaded notifications: performAuth emits one
  // ({reconnect:true}) AFTER the version-set path on every reconnect, so it is a
  // client-side barrier proving the re-auth's onGodotVersion call already ran.
  let reconnects = 0;
  bridge.onNotification((type, params) => {
    if (type === "config_reloaded" && (params as { reconnect?: boolean } | undefined)?.reconnect === true) reconnects++;
  });

  try {
    // First connect → transition → fires once.
    await bridge.call("warmup", {}, 5000);
    await ioFlush();
    assert.equal(count, 1, "fired once on the first auth");
    assert.equal(server.authCount(), 1, "server answered one auth");

    // Drop the connection; the bridge auto-reconnects and re-auths, re-delivering
    // "4.5" (known → known). The hook must not fire a second time.
    server.dropClients();
    await waitFor(() => reconnects >= 1, "reconnect re-auth to complete");
    await ioFlush();

    assert.ok(server.authCount() >= 2, "server re-authed on reconnect");
    assert.equal(count, 1, "hook must NOT re-fire — re-auth is known → known, not a transition");
    assert.deepEqual(bridge.getGodotVersion(), [4, 5], "version still resolved after reconnect");
    console.log("  PASS: onGodotVersionKnown does NOT re-fire on a reconnect re-auth");
  } finally {
    await bridge.close();
    await server.close();
  }
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log("Bridge onGodotVersionKnown tests:");
  await testFiresOnceOnTransition();
  await testNoFireWhenPrePopulated();
  await testNoRefireOnReconnect();
  console.log("All bridge version-hook tests passed.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    try {
      rmSync(tmpDir, { recursive: true });
    } catch {
      /* ignore */
    }
  });
