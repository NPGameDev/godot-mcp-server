/**
 * Pins the bridge's editor-port re-discovery — the orchestrator-level reconnect
 * the channel-level tests cannot see. When the Godot editor plugin restarts on a
 * different port, the bridge re-reads the project registry, swaps the editor
 * channel to the new port, and retries the failed call exactly once. These tests
 * fix that swap-and-retry contract plus its guard branches:
 *   - port changed  → close old channel, connect the new one, retry once (resolves)
 *   - same port     → no swap; the original CONNECT_FAILED surfaces unchanged
 *   - no entry      → no swap (registry lookup miss)
 *   - explicit port → re-discovery short-circuits (GODOT_MCP_PORT pins the URL)
 *   - TTL window    → a second failure within 5s does not re-read the registry
 *
 * Trigger: a COLD editor channel aimed at a dead port fails fast with
 * CONNECT_FAILED (no hot-reconnect await) — one of the two codes the bridge
 * catches to drive re-discovery — so the whole path runs deterministically with
 * no fake timers. The new server's auth count is the routing oracle: it proves
 * the retry hit the new port rather than a coincidental pass.
 *
 * Registry/token contract mirrors bridge-version-hook.test.ts: one hermetic temp
 * dir holds both the auth token (GODOT_MCP_TOKEN_PATH short-circuits token
 * resolution) and the redirected projects.json (via the APPDATA / XDG_DATA_HOME
 * override registryPath() honors). darwin hardcodes ~/Library with no override,
 * so the registry-dependent cases skip there and run in CI on Linux.
 */

import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { WebSocketServer, WebSocket as WS } from "ws";
import type { AddressInfo } from "node:net";
import { normalizePath, registryPath, type RegistryEntry } from "../../src/registry.js";
import { BridgeError } from "../../src/shared/errors.js";

// ── Hermetic environment (token + registry redirect) ─────────────────

const REDIRECT: string | null =
  process.platform === "win32" ? "APPDATA" : process.platform === "linux" ? "XDG_DATA_HOME" : null;

const tmpDir = mkdtempSync(join(tmpdir(), "mcp-redisc-"));
const tokenPath = join(tmpDir, "mcp_token");
writeFileSync(tokenPath, "test-token-for-unit-tests");
process.env.GODOT_MCP_TOKEN_PATH = tokenPath;
if (REDIRECT) process.env[REDIRECT] = tmpDir;

// Import AFTER the env mutation so registryPath() resolves under the redirect.
const { createBridge } = await import("../../src/transport/bridge.js");

// ── Registry seeding helpers (no-op on darwin) ───────────────────────

/** Build a complete RegistryEntry, overriding only the field a case cares about. */
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

// Start empty so createBridge pre-populates nothing a case did not seed.
writeRegistry({});

// ── Mock editor WebSocket server ─────────────────────────────────────

interface MockServer {
  port: number;
  /** Auth handshakes answered — one per connect. The routing oracle: a retry
   *  that reached THIS server bumps it to 1. */
  authCount: () => number;
  close: () => Promise<void>;
}

/**
 * A minimal editor stand-in: answers the auth handshake (so the channel reaches
 * the connected state) and echoes a benign success for any RPC id.
 */
function makeMockServer(): Promise<MockServer> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    const sockets = new Set<WS>();
    let auths = 0;
    wss.on("listening", () => {
      resolve({
        port: (wss.address() as AddressInfo).port,
        authCount: () => auths,
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
          sock.send(JSON.stringify({ authed: true, godot_version: "4.5", version: "1.0.0" }));
          return;
        }
        if (msg.id != null) sock.send(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { ok: true } }));
      });
    });
  });
}

/**
 * Yield a port number that now refuses connections: bind an ephemeral port, then
 * free it. A cold channel aimed here fails fast with CONNECT_FAILED — the
 * dead-editor (plugin-restarted-elsewhere) stand-in.
 */
async function getDeadPort(): Promise<number> {
  const probe = await makeMockServer();
  const port = probe.port;
  await probe.close();
  return port;
}

// ── Case 1: a port change swaps the channel and the retry resolves ───

async function testPortChangeSwapsAndRetries() {
  if (!REDIRECT) {
    console.log("  SKIP (darwin: no registry path override): port-change swap");
    return;
  }
  const projectPath = "/__godot_mcp_unit_test__/rediscover-swap";
  // Stand up the NEW editor first so the dead OLD port is guaranteed distinct
  // (the live server holds its port, so the probe gets a different one).
  const serverNew = await makeMockServer();
  const portOld = await getDeadPort();
  // Registry points the project at the live new port; the bridge starts aimed at
  // the dead old port — the pre-restart endpoint it cached at build.
  writeRegistry({ [normalizePath(projectPath)]: makeEntry({ port: serverNew.port }) });
  const bridge = createBridge(`ws://127.0.0.1:${portOld}`, { projectPath });

  try {
    // The first attempt hits the dead old port (cold → CONNECT_FAILED fast); the
    // bridge re-reads the registry, sees the changed port, swaps the channel, and
    // retries once against the live new port.
    const r = await bridge.call("echo", { ping: 1 }, 5000);
    assert.deepEqual(r, { ok: true }, "call resolves against the new editor after the swap");
    assert.equal(
      serverNew.authCount(),
      1,
      "exactly one auth routed to the new port — the retry reached portNew, not portOld",
    );
    console.log("  PASS: a registry port change swaps the channel and the retried call resolves");
  } finally {
    await bridge.close();
    await serverNew.close();
  }
}

// ── Case 2: an unchanged registry port triggers no swap ──────────────

async function testSamePortDoesNotSwap() {
  if (!REDIRECT) {
    console.log("  SKIP (darwin: no registry path override): same-port no-swap");
    return;
  }
  const projectPath = "/__godot_mcp_unit_test__/rediscover-same-port";
  const portOld = await getDeadPort();
  // Registry agrees with the (dead) cached port → re-discovery has nothing to swap.
  writeRegistry({ [normalizePath(projectPath)]: makeEntry({ port: portOld }) });
  const bridge = createBridge(`ws://127.0.0.1:${portOld}`, { projectPath });

  try {
    await assert.rejects(
      bridge.call("echo", {}, 5000),
      (err: unknown) => err instanceof BridgeError && err.code === "CONNECT_FAILED",
      "same registry port → no swap; the original CONNECT_FAILED propagates",
    );
    console.log("  PASS: a same-port registry entry triggers no swap (CONNECT_FAILED propagates)");
  } finally {
    await bridge.close();
  }
}

// ── Case 3: an absent registry entry triggers no swap ────────────────

async function testNoRegistryEntryDoesNotSwap() {
  if (!REDIRECT) {
    console.log("  SKIP (darwin: no registry path override): no-entry no-swap");
    return;
  }
  const projectPath = "/__godot_mcp_unit_test__/rediscover-no-entry";
  const portOld = await getDeadPort();
  writeRegistry({}); // no entry for this project → registry lookup misses
  const bridge = createBridge(`ws://127.0.0.1:${portOld}`, { projectPath });

  try {
    await assert.rejects(
      bridge.call("echo", {}, 5000),
      (err: unknown) => err instanceof BridgeError && err.code === "CONNECT_FAILED",
      "no registry entry → no swap; CONNECT_FAILED propagates",
    );
    console.log("  PASS: an absent registry entry triggers no swap (CONNECT_FAILED propagates)");
  } finally {
    await bridge.close();
  }
}

// ── Case 4: explicitEditorPort short-circuits re-discovery ───────────

async function testExplicitEditorPortShortCircuits() {
  if (!REDIRECT) {
    console.log("  SKIP (darwin: no registry path override): explicit-port short-circuit");
    return;
  }
  const projectPath = "/__godot_mcp_unit_test__/rediscover-explicit-port";
  // The registry points at a LIVE new port, but the pinned URL must win:
  // re-discovery short-circuits and never contacts that live port.
  const serverNew = await makeMockServer();
  const portOld = await getDeadPort();
  writeRegistry({ [normalizePath(projectPath)]: makeEntry({ port: serverNew.port }) });
  const bridge = createBridge(`ws://127.0.0.1:${portOld}`, { projectPath, explicitEditorPort: true });

  try {
    await assert.rejects(
      bridge.call("echo", {}, 5000),
      (err: unknown) => err instanceof BridgeError && err.code === "CONNECT_FAILED",
      "explicitEditorPort → re-discovery short-circuits; CONNECT_FAILED propagates",
    );
    assert.equal(serverNew.authCount(), 0, "the live new port was never contacted — the static-port guard held");
    console.log("  PASS: explicitEditorPort short-circuits re-discovery even when the registry port changed");
  } finally {
    await bridge.close();
    await serverNew.close();
  }
}

// ── Case 5: the TTL guard blocks a second re-discovery within 5s ─────

async function testTtlGuardBlocksSecondRediscover() {
  if (!REDIRECT) {
    console.log("  SKIP (darwin: no registry path override): TTL thrash-guard");
    return;
  }
  const projectPath = "/__godot_mcp_unit_test__/rediscover-ttl";
  const serverNew = await makeMockServer();
  const portOld = await getDeadPort();
  // First call: the registry agrees with the dead cached port, so re-discovery
  // runs but swaps nothing — yet it still stamps the TTL clock.
  writeRegistry({ [normalizePath(projectPath)]: makeEntry({ port: portOld }) });
  const bridge = createBridge(`ws://127.0.0.1:${portOld}`, { projectPath });

  try {
    await assert.rejects(
      bridge.call("echo", {}, 5000),
      (err: unknown) => err instanceof BridgeError && err.code === "CONNECT_FAILED",
      "first failed call stamps the re-discovery TTL",
    );
    // The editor genuinely moves to the live new port now. The second call lands
    // well within the 5s TTL (millisecond-real elapsed between two failures), so
    // the thrash-guard refuses the re-read and the live port is never adopted —
    // proven by its zero auth count. Real timers suffice precisely because two
    // back-to-back failures are inherently sub-5s apart; no clock faking needed.
    writeRegistry({ [normalizePath(projectPath)]: makeEntry({ port: serverNew.port }) });
    await assert.rejects(
      bridge.call("echo", {}, 5000),
      (err: unknown) => err instanceof BridgeError && err.code === "CONNECT_FAILED",
      "second call within the TTL → no re-read; CONNECT_FAILED propagates",
    );
    assert.equal(serverNew.authCount(), 0, "the TTL guard blocked the swap — the live new port was never contacted");
    console.log("  PASS: the re-discovery TTL blocks a second swap within the 5s window");
  } finally {
    await bridge.close();
    await serverNew.close();
  }
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log("Bridge editor-port re-discovery tests:");
  await testPortChangeSwapsAndRetries();
  await testSamePortDoesNotSwap();
  await testNoRegistryEntryDoesNotSwap();
  await testExplicitEditorPortShortCircuits();
  await testTtlGuardBlocksSecondRediscover();
  console.log("All 5 bridge-rediscover tests passed.");
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
