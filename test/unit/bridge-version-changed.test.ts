/**
 * Deterministic unit tests for the onGodotVersionChanged bridge hook. It fires when a
 * known Godot version is replaced by one with a different major.minor, so the
 * composition root can re-render what was built from the old version. These tests pin:
 *   1. unknown → known fires the version-known hook only,
 *   2. a re-auth that delivers a different minor (4.4 → 4.5) fires the changed hook once,
 *   3. a re-auth that delivers a different patch (4.5.0 → 4.5.1) fires nothing,
 *   4. a registry-seeded version replaced at first auth fires the changed hook.
 *
 * Registry/token setup mirrors bridge-version-hook.test.ts. darwin hardcodes
 * ~/Library with no override, so the registry-seeding case is skipped there.
 */

import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { WebSocketServer, WebSocket as WS } from "ws";
import type { AddressInfo } from "node:net";
import { normalizePath, registryPath, type RegistryEntry } from "../../src/registry.js";

// ── Hermetic environment (token + registry redirect) ─────────────────

const REDIRECT: string | null =
  process.platform === "win32" ? "APPDATA" : process.platform === "linux" ? "XDG_DATA_HOME" : null;

const tmpDir = mkdtempSync(join(tmpdir(), "mcp-vchanged-"));
const tokenPath = join(tmpDir, "mcp_token");
writeFileSync(tokenPath, "test-token-for-unit-tests");
process.env.GODOT_MCP_TOKEN_PATH = tokenPath;
if (REDIRECT) process.env[REDIRECT] = tmpDir;

const { createBridge } = await import("../../src/transport/bridge.js");

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

writeRegistry({});

// ── Mock editor WebSocket server ─────────────────────────────────────

interface MockServer {
  port: number;
  /** Change the Godot version the next auth handshake reports. */
  setGodotVersion: (v: string) => void;
  /** Forcibly terminate every connected client → drives a bridge reconnect. */
  dropClients: () => void;
  close: () => Promise<void>;
}

/** A minimal editor stand-in that answers auth with a settable `godot_version`. */
function makeMockServer(initialVersion: string): Promise<MockServer> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    const sockets = new Set<WS>();
    let godotVersion = initialVersion;
    wss.on("listening", () => {
      resolve({
        port: (wss.address() as AddressInfo).port,
        setGodotVersion: (v) => {
          godotVersion = v;
        },
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
          sock.send(JSON.stringify({ authed: true, version: "1.0.0", godot_version: godotVersion }));
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

/** Poll a condition until true or the deadline elapses. */
async function waitFor(cond: () => boolean, label: string, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error(`waitFor timed out: ${label}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** Connect a bridge to `server`, count both hooks, and track reconnect re-auths. */
function connectCounting(server: MockServer, projectPath: string) {
  const bridge = createBridge(`ws://127.0.0.1:${server.port}`, { projectPath, explicitEditorPort: true });
  const counts = { known: 0, changed: 0, reconnects: 0 };
  bridge.onGodotVersionKnown(() => {
    counts.known++;
  });
  bridge.onGodotVersionChanged(() => {
    counts.changed++;
  });
  // performAuth emits config_reloaded({reconnect:true}) AFTER it records the version,
  // so a reconnect count is a barrier proving the re-auth's version-set already ran.
  bridge.onNotification((type, params) => {
    if (type === "config_reloaded" && (params as { reconnect?: boolean } | undefined)?.reconnect === true) {
      counts.reconnects++;
    }
  });
  return { bridge, counts };
}

/** Drop the connection and wait until the bridge has re-authed. */
async function reauth(server: MockServer, counts: { reconnects: number }): Promise<void> {
  const before = counts.reconnects;
  server.dropClients();
  await waitFor(() => counts.reconnects > before, "reconnect re-auth to complete");
  await ioFlush();
}

// ── Test 1: unknown → known fires the known hook only ────────────────

async function testUnknownToKnown() {
  const server = await makeMockServer("4.5");
  const { bridge, counts } = connectCounting(server, "/__godot_mcp_unit_test__/version-changed-first");
  try {
    assert.equal(bridge.getGodotVersion(), undefined, "version is unknown before auth");
    await bridge.call("warmup", {}, 5000);
    await ioFlush();
    assert.equal(counts.known, 1, "the version-known hook fires on unknown → known");
    assert.equal(counts.changed, 0, "unknown → known is not a change");
    console.log("  PASS: unknown → known fires the version-known hook only");
  } finally {
    await bridge.close();
    await server.close();
  }
}

// ── Test 2: a different major.minor fires the changed hook once ──────

async function testMinorChange() {
  const server = await makeMockServer("4.4");
  const { bridge, counts } = connectCounting(server, "/__godot_mcp_unit_test__/version-changed-minor");
  try {
    await bridge.call("warmup", {}, 5000);
    await ioFlush();
    assert.deepEqual(bridge.getGodotVersion(), [4, 4]);
    assert.equal(counts.changed, 0, "the first auth is not a change");

    server.setGodotVersion("4.5");
    await reauth(server, counts);

    assert.deepEqual(bridge.getGodotVersion(), [4, 5], "the bridge holds the new version");
    assert.equal(counts.changed, 1, "4.4 → 4.5 fires the version-changed hook once");
    assert.equal(counts.known, 1, "the version-known hook does not fire again");
    console.log("  PASS: a different major.minor fires the version-changed hook once");
  } finally {
    await bridge.close();
    await server.close();
  }
}

// ── Test 3: a patch-only change fires nothing ────────────────────────

async function testPatchChange() {
  const server = await makeMockServer("4.5.0");
  const { bridge, counts } = connectCounting(server, "/__godot_mcp_unit_test__/version-changed-patch");
  try {
    await bridge.call("warmup", {}, 5000);
    await ioFlush();

    server.setGodotVersion("4.5.1");
    await reauth(server, counts);

    assert.equal(bridge.getGodotVersionString(), "4.5.1", "the bridge holds the new patch version");
    assert.equal(counts.changed, 0, "4.5.0 → 4.5.1 fires nothing");
    assert.equal(counts.known, 1, "the version-known hook fired only for the first auth");
    console.log("  PASS: a patch-only change fires nothing");
  } finally {
    await bridge.close();
    await server.close();
  }
}

// ── Test 4: a registry-seeded version replaced at first auth ─────────

async function testRegistrySeededChange() {
  if (!REDIRECT) {
    console.log("  SKIP (darwin: no registry path override): registry-seeded case");
    return;
  }
  const projectPath = "/__godot_mcp_unit_test__/version-changed-seeded";
  writeRegistry({ [normalizePath(projectPath)]: makeEntry({ godot_version: "4.4" }) });
  const server = await makeMockServer("4.5");
  const { bridge, counts } = connectCounting(server, projectPath);
  try {
    assert.deepEqual(bridge.getGodotVersion(), [4, 4], "version pre-populated from the registry");
    await bridge.call("warmup", {}, 5000);
    await ioFlush();
    assert.deepEqual(bridge.getGodotVersion(), [4, 5], "the auth replaced the registry's version");
    assert.equal(counts.changed, 1, "a registry version replaced by another minor fires the hook");
    assert.equal(counts.known, 0, "the registry already made the version known");
    console.log("  PASS: a registry-seeded version replaced at first auth fires the hook");
  } finally {
    await bridge.close();
    await server.close();
    writeRegistry({});
  }
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log("Bridge onGodotVersionChanged tests:");
  await testUnknownToKnown();
  await testMinorChange();
  await testPatchChange();
  await testRegistrySeededChange();
  console.log("All bridge version-changed tests passed.");
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
