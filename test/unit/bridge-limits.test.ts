/**
 * Unit tests for the bridge's post-auth push of its env overrides.
 *
 * After every editor auth, the bridge sends `meta.set_limits` carrying its whole
 * set of env overrides: exactly the caps it was given, or `{}` when it was given
 * none. A toolkit that replaces its env overrides with each push relies on the
 * push being the full set and on it arriving after every auth: a reconnect to the
 * same port, and the channel an editor-port re-discovery opens.
 *
 * Every wait is on an explicit signal: a call resolving (it cannot resolve before
 * auth), or the mock's receipt of a given number of frames. A short real-time
 * drain after a push shows that no duplicate followed it. None counts event-loop
 * turns.
 */

import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { WebSocketServer, type WebSocket as WS } from "ws";
import type { AddressInfo } from "node:net";
import { normalizePath, registryPath, type RegistryEntry } from "../../src/registry.js";
import { getServerVersion } from "../../src/shared/version.js";

// ── Hermetic environment (token + registry redirect) ─────────────────
// GODOT_MCP_TOKEN_PATH points auth at a temp token. The registry root is
// redirected into the same temp dir (APPDATA / XDG_DATA_HOME, which registryPath()
// honors) so the bridge's registry reads and the runtime connection's registry
// watcher never touch the real file. darwin has no override: the cases that seed
// no entries run there unchanged, and the re-discovery case, which needs one,
// skips there. The runner gives each file its own subprocess, so these
// module-scope env mutations don't leak.
const REDIRECT: string | undefined =
  process.platform === "win32" ? "APPDATA" : process.platform === "linux" ? "XDG_DATA_HOME" : undefined;

const tmpDir = mkdtempSync(join(tmpdir(), "mcp-limits-"));
const tokenPath = join(tmpDir, "mcp_token");
writeFileSync(tokenPath, "test-token-for-unit-tests");
process.env.GODOT_MCP_TOKEN_PATH = tokenPath;

/** Write projects.json under the redirected registry root. No-op on darwin. */
function writeRegistry(byPath: Record<string, RegistryEntry>): void {
  if (!REDIRECT) return;
  mkdirSync(dirname(registryPath()), { recursive: true });
  writeFileSync(registryPath(), JSON.stringify({ by_path: byPath }));
}

if (REDIRECT) {
  process.env[REDIRECT] = tmpDir;
  writeRegistry({});
}

const { createBridge } = await import("../../src/transport/bridge.js");

/** Wall-clock bound on a readiness wait. Generous on purpose: only a genuine failure waits it out. */
const WAIT_TIMEOUT_MS = 8000;

/** Real time allowed after auth for a push that should not come. A loopback frame lands in well under this. */
const DRAIN_MS = 250;

// ── Mock editor (answers auth, records every other frame) ────────────

interface ReceivedFrame {
  id?: unknown;
  method?: string;
  params?: Record<string, unknown>;
}

interface MockEditor {
  port: number;
  /** Auth handshakes answered (one per connect). */
  authCount: () => number;
  /** Every non-auth frame received, in arrival order. */
  received: () => ReceivedFrame[];
  /** Resolve once `count` frames (default 1) carrying `method` have arrived (at once if they already have); reject naming `label` after `WAIT_TIMEOUT_MS`. */
  waitForReceived: (method: string, label: string, count?: number) => Promise<void>;
  /** Terminate every open connection but keep listening, so the bridge's channel reconnects to the same port. */
  dropConnections: () => void;
  close: () => Promise<void>;
}

/** Settle as `pending` settles, or reject naming `label` once `WAIT_TIMEOUT_MS` has passed. */
function withinWallClock(pending: Promise<void>, label: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const deadline = setTimeout(
      () => reject(new Error(`readiness wait timed out after ${WAIT_TIMEOUT_MS}ms: ${label}`)),
      WAIT_TIMEOUT_MS,
    );
    void pending.then(resolve, reject).finally(() => clearTimeout(deadline));
  });
}

/**
 * A minimal editor stand-in. The auth ack carries `godot_version` because the
 * bridge pushes limits from the callback that records the version, and `version`
 * echoes the server's own so no compatibility warning is printed. Every RPC gets
 * a benign success result.
 */
function makeMockEditor(): Promise<MockEditor> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    const sockets = new Set<WS>();
    const received: ReceivedFrame[] = [];
    // One per pending waitForReceived, woken with every frame the mock records.
    const receiptWaiters = new Set<(frame: ReceivedFrame) => void>();
    let auths = 0;
    wss.on("listening", () => {
      resolve({
        port: (wss.address() as AddressInfo).port,
        authCount: () => auths,
        received: () => received,
        waitForReceived: (method, label, count = 1) => {
          const reached = (): boolean => received.filter((f) => f.method === method).length >= count;
          let waiter: ((frame: ReceivedFrame) => void) | undefined;
          const arrived = new Promise<void>((resolveArrived) => {
            if (reached()) {
              resolveArrived();
              return;
            }
            waiter = () => {
              if (reached()) resolveArrived();
            };
            receiptWaiters.add(waiter);
          });
          return withinWallClock(arrived, label).finally(() => {
            if (waiter) receiptWaiters.delete(waiter);
          });
        },
        dropConnections: () => {
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
        let frame: ReceivedFrame & { auth?: unknown };
        try {
          frame = JSON.parse(data.toString()) as ReceivedFrame & { auth?: unknown };
        } catch {
          return;
        }
        if (frame.auth !== undefined) {
          auths++;
          sock.send(JSON.stringify({ authed: true, godot_version: "4.5", version: getServerVersion() }));
          return;
        }
        received.push(frame);
        if (frame.id != null) sock.send(JSON.stringify({ jsonrpc: "2.0", id: frame.id, result: { success: true } }));
        for (const wake of receiptWaiters) wake(frame);
      });
    });
  });
}

function limitsPushes(editor: MockEditor): ReceivedFrame[] {
  return editor.received().filter((f) => f.method === "meta.set_limits");
}

function drain(): Promise<void> {
  return new Promise((r) => setTimeout(r, DRAIN_MS));
}

// ── 1. No caps given → one push of the empty set after auth ──────────

async function testNoCapsPushesEmptySet(): Promise<void> {
  const editor = await makeMockEditor();
  const bridge = createBridge(`ws://127.0.0.1:${editor.port}`, {
    projectPath: "/__godot_mcp_unit_test__/limits-none",
    explicitEditorPort: true,
  });
  try {
    // The first call drives connect + auth, so its result proves auth was answered.
    await bridge.call("probe", {}, 5000);
    assert.equal(editor.authCount(), 1, "the editor answered one auth");
    await editor.waitForReceived("meta.set_limits", "post-auth empty-set push");
    await drain(); // a duplicate push would land in this window too
    const pushes = limitsPushes(editor);
    assert.equal(pushes.length, 1, "exactly one meta.set_limits frame after auth when no cap is configured");
    assert.deepEqual(pushes[0].params, {}, "the push carries the empty set, which clears the editor's env overrides");
    console.log("  PASS: no caps given → one meta.set_limits with {} after auth");
  } finally {
    await bridge.close();
    await editor.close();
  }
}

// ── 2. Only the script cap given → one push carrying only that cap ───

async function testScriptCapOnly(): Promise<void> {
  const editor = await makeMockEditor();
  const bridge = createBridge(`ws://127.0.0.1:${editor.port}`, {
    projectPath: "/__godot_mcp_unit_test__/limits-script",
    explicitEditorPort: true,
    scriptReadLimitBytes: 512 * 1024,
  });
  try {
    await bridge.call("probe", {}, 5000);
    await editor.waitForReceived("meta.set_limits", "post-auth limits push");
    await drain(); // a duplicate push would land in this window too
    const pushes = limitsPushes(editor);
    assert.equal(pushes.length, 1, "exactly one meta.set_limits frame after auth");
    assert.deepEqual(pushes[0].params, { script_read_cap_kb: 512 }, "the push carries only the script cap, in KB");
    console.log("  PASS: only scriptReadLimitBytes → one push with only script_read_cap_kb");
  } finally {
    await bridge.close();
    await editor.close();
  }
}

// ── 3. Both caps given → one push carrying both ──────────────────────

async function testBothCaps(): Promise<void> {
  const editor = await makeMockEditor();
  const bridge = createBridge(`ws://127.0.0.1:${editor.port}`, {
    projectPath: "/__godot_mcp_unit_test__/limits-both",
    explicitEditorPort: true,
    scriptReadLimitBytes: 512 * 1024,
    wsBufferLimitBytes: 2048 * 1024,
  });
  try {
    await bridge.call("probe", {}, 5000);
    await editor.waitForReceived("meta.set_limits", "post-auth limits push");
    await drain();
    const pushes = limitsPushes(editor);
    assert.equal(pushes.length, 1, "exactly one meta.set_limits frame after auth");
    assert.deepEqual(
      pushes[0].params,
      { script_read_cap_kb: 512, ws_buffer_kb: 2048 },
      "the push carries both caps, in KB",
    );
    console.log("  PASS: both caps → one push with script_read_cap_kb and ws_buffer_kb");
  } finally {
    await bridge.close();
    await editor.close();
  }
}

// ── 4. A reconnect to the same port → a second auth and a second push ─

async function testReconnectPushesAgain(): Promise<void> {
  const editor = await makeMockEditor();
  const bridge = createBridge(`ws://127.0.0.1:${editor.port}`, {
    projectPath: "/__godot_mcp_unit_test__/limits-reconnect",
    explicitEditorPort: true,
  });
  try {
    await bridge.call("probe", {}, 5000);
    await editor.waitForReceived("meta.set_limits", "first post-auth empty-set push");
    // The channel was connected, so a dropped socket is a hot disconnect: it
    // reconnects to the same port on its own, with no call to drive it.
    editor.dropConnections();
    await editor.waitForReceived("meta.set_limits", "post-reconnect empty-set push", 2);
    await drain();
    assert.equal(editor.authCount(), 2, "the editor answered a second auth on the reconnect");
    const pushes = limitsPushes(editor);
    assert.equal(pushes.length, 2, "one meta.set_limits frame per auth");
    assert.deepEqual(pushes[0].params, {}, "the first auth pushes the empty set");
    assert.deepEqual(pushes[1].params, {}, "the reconnect pushes the empty set again");
    console.log("  PASS: a reconnect authenticates again and pushes the empty set again");
  } finally {
    await bridge.close();
    await editor.close();
  }
}

// ── 5. A channel opened by editor-port re-discovery → it pushes too ──

/** Yield a port that now refuses connections: bind an ephemeral one, then free it. */
async function getDeadPort(): Promise<number> {
  const probe = await makeMockEditor();
  const port = probe.port;
  await probe.close();
  return port;
}

async function testRediscoveredChannelPushes(): Promise<void> {
  if (!REDIRECT) {
    console.log("  SKIP (darwin: no registry path override): re-discovered channel push");
    return;
  }
  const projectPath = "/__godot_mcp_unit_test__/limits-rediscover";
  // Stand up the new editor first so the dead old port cannot collide with it.
  const editorNew = await makeMockEditor();
  const portOld = await getDeadPort();
  writeRegistry({
    [normalizePath(projectPath)]: {
      port: editorNew.port,
      token_path: "tok",
      pid: process.pid,
      started_at: 1000,
      runtime_port: null,
      runtime_pid: null,
    },
  });
  // Unpinned and aimed at the dead port: the first call fails to connect, the
  // bridge re-reads the registry, opens a channel to the new port and retries.
  const bridge = createBridge(`ws://127.0.0.1:${portOld}`, {
    projectPath,
    scriptReadLimitBytes: 512 * 1024,
  });
  try {
    await bridge.call("probe", {}, 5000);
    assert.equal(editorNew.authCount(), 1, "the retry authenticated on the re-discovered port");
    await editorNew.waitForReceived("meta.set_limits", "post-rediscovery limits push");
    await drain();
    const pushes = limitsPushes(editorNew);
    assert.equal(pushes.length, 1, "the re-discovered channel pushes once after its auth");
    assert.deepEqual(pushes[0].params, { script_read_cap_kb: 512 }, "it pushes the server's env overrides");
    console.log("  PASS: the channel an editor-port re-discovery opens pushes the env overrides");
  } finally {
    await bridge.close();
    await editorNew.close();
    writeRegistry({});
  }
}

// ── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("Bridge env-override push tests:");
  await testNoCapsPushesEmptySet();
  await testScriptCapOnly();
  await testBothCaps();
  await testReconnectPushesAgain();
  await testRediscoveredChannelPushes();
  console.log("All bridge-limits tests passed.");
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
      // Best-effort cleanup: a leftover directory in the OS temp folder is harmless.
    }
  });
