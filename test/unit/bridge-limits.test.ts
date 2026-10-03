/**
 * Unit tests for the bridge's post-auth response-caps push.
 *
 * After the editor authenticates, the bridge sends `meta.set_limits` carrying only
 * the caps it was given, and with none given it sends nothing. The plugin applies
 * the call in memory, so a push the operator did not ask for overrides the
 * project's own `mcp_toolkit/limits/*` settings for as long as the editor runs.
 *
 * Every wait is on an explicit signal: a call resolving (it cannot resolve before
 * auth), the mock's receipt of a frame, or, to show that nothing arrived, a short
 * real-time drain after auth. None counts event-loop turns.
 */

import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { WebSocketServer, type WebSocket as WS } from "ws";
import type { AddressInfo } from "node:net";
import { registryPath } from "../../src/registry.js";
import { getServerVersion } from "../../src/shared/version.js";

// ── Hermetic environment (token + registry redirect) ─────────────────
// GODOT_MCP_TOKEN_PATH points auth at a temp token. The registry root is
// redirected into the same temp dir (APPDATA / XDG_DATA_HOME, which registryPath()
// honors) so the bridge's registry reads and the runtime connection's registry
// watcher never touch the real file; darwin has no override, and these cases seed
// no entries, so they run there unchanged. The runner gives each file its own
// subprocess, so these module-scope env mutations don't leak.
const REDIRECT: string | undefined =
  process.platform === "win32" ? "APPDATA" : process.platform === "linux" ? "XDG_DATA_HOME" : undefined;

const tmpDir = mkdtempSync(join(tmpdir(), "mcp-limits-"));
const tokenPath = join(tmpDir, "mcp_token");
writeFileSync(tokenPath, "test-token-for-unit-tests");
process.env.GODOT_MCP_TOKEN_PATH = tokenPath;
if (REDIRECT) {
  process.env[REDIRECT] = tmpDir;
  mkdirSync(dirname(registryPath()), { recursive: true });
  writeFileSync(registryPath(), JSON.stringify({ by_path: {} }));
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
  /** Resolve once a frame carrying `method` has arrived (at once if one already has); reject naming `label` after `WAIT_TIMEOUT_MS`. */
  waitForReceived: (method: string, label: string) => Promise<void>;
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
        waitForReceived: (method, label) => {
          let waiter: ((frame: ReceivedFrame) => void) | undefined;
          const arrived = new Promise<void>((resolveArrived) => {
            if (received.some((f) => f.method === method)) {
              resolveArrived();
              return;
            }
            waiter = (frame) => {
              if (frame.method === method) resolveArrived();
            };
            receiptWaiters.add(waiter);
          });
          return withinWallClock(arrived, label).finally(() => {
            if (waiter) receiptWaiters.delete(waiter);
          });
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

// ── 1. No caps given → nothing pushed after auth ─────────────────────

async function testNoCapsPushesNothing(): Promise<void> {
  const editor = await makeMockEditor();
  const bridge = createBridge(`ws://127.0.0.1:${editor.port}`, {
    projectPath: "/__godot_mcp_unit_test__/limits-none",
    explicitEditorPort: true,
  });
  try {
    // The first call drives connect + auth, so its result proves auth was answered.
    await bridge.call("probe", {}, 5000);
    assert.equal(editor.authCount(), 1, "the editor answered one auth");
    await drain();
    assert.equal(limitsPushes(editor).length, 0, "no meta.set_limits frame when no cap is configured");
    console.log("  PASS: no caps given → no meta.set_limits after auth");
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

// ── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("Bridge response-caps push tests:");
  await testNoCapsPushesNothing();
  await testScriptCapOnly();
  await testBothCaps();
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
