/**
 * Deterministic unit tests for _queued/_executing notification handling
 * in bridge.ts (iter 41l-decies).
 *
 * Uses @sinonjs/fake-timers to control setTimeout/clearTimeout only,
 * leaving setImmediate and other I/O timers real so WebSocket works.
 *
 * Tests verify that the bridge resets its pending-request timeout when it
 * receives a _queued or _executing JSON-RPC notification from the toolkit.
 */

import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WebSocketServer, WebSocket as WS } from "ws";
import type { AddressInfo } from "node:net";
import FakeTimers from "@sinonjs/fake-timers";

// Set up a fake token file before importing createBridge.
const tmpDir = mkdtempSync(join(tmpdir(), "mcp-test-"));
const tokenPath = join(tmpDir, "mcp_token");
writeFileSync(tokenPath, "test-token-for-unit-tests");
process.env.GODOT_MCP_TOKEN_PATH = tokenPath;

const { createBridge } = await import("../../src/transport/bridge.js");

// ── Helpers ──────────────────────────────────────────────────────────

function makeMockServer(handler: (sock: WS, msg: { id: unknown; method?: string }) => void) {
  return new Promise<{ port: number; close: () => Promise<void> }>((resolve) => {
    const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    const sockets = new Set<WS>();
    wss.on("listening", () => {
      resolve({
        port: (wss.address() as AddressInfo).port,
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
        try {
          const msg = JSON.parse(data.toString()) as {
            auth?: unknown;
            id?: unknown;
            method?: string;
          };
          if (msg.auth !== undefined) {
            sock.send(JSON.stringify({ authed: true, godotVersion: "4.5", toolkitVersion: "1.0.0" }));
            return;
          }
          if (msg.id != null) handler(sock, msg as { id: unknown; method?: string });
        } catch {
          // ignore
        }
      });
    });
  });
}

function notify(sock: WS, method: string, requestId: unknown) {
  sock.send(JSON.stringify({ jsonrpc: "2.0", method, params: { request_id: requestId } }));
}

function respond(sock: WS, id: unknown, result: unknown) {
  sock.send(JSON.stringify({ jsonrpc: "2.0", id, result }));
}

/** Wait for real I/O (microtasks + next event loop tick). */
function ioFlush(): Promise<void> {
  return new Promise((r) => setImmediate(r));
}

// ── Tests ────────────────────────────────────────────────────────────

// Test 1: _queued notification resets timeout.
// Without notification: call times out when clock advances past timeout.
// With _queued: timer resets, so advancing past original deadline doesn't time out.
async function testQueuedPreventsTimeout() {
  let callCount = 0;
  let capturedSock: WS | null = null;
  let capturedId: unknown = null;

  const server = await makeMockServer((sock, msg) => {
    callCount++;
    if (callCount === 1) {
      // First call: respond immediately (warmup to complete auth).
      respond(sock, msg.id, { warmup: true });
    } else {
      // Second call: capture for controlled test.
      capturedSock = sock;
      capturedId = msg.id;
    }
  });

  const bridge = createBridge(`ws://127.0.0.1:${server.port}`, {
    projectPath: "/tmp/test",
    explicitEditorPort: true,
  });

  // Warmup call forces auth to complete with real timers.
  await bridge.call("warmup", {}, 5000);
  await ioFlush();

  // Install fake timers — only setTimeout/clearTimeout.
  const clock = FakeTimers.install({ toFake: ["setTimeout", "clearTimeout"] });

  try {
    // Start a call with 800ms timeout.
    let resolved = false;
    let rejected: Error | null = null;
    const callPromise = bridge.call("echo", {}, 800).then(
      (r) => {
        resolved = true;
        return r;
      },
      (e: Error) => {
        rejected = e;
        throw e;
      },
    );
    await ioFlush();

    // Advance 400ms — halfway to timeout.
    await clock.tickAsync(400);
    await ioFlush();
    assert.ok(!resolved && !rejected, "Call should still be pending at 400ms");

    // Server sends _queued → timer resets.
    assert.ok(capturedSock && capturedId, "Server should have received the RPC");
    notify(capturedSock!, "_queued", capturedId);
    await ioFlush();
    await ioFlush();

    // Advance another 600ms (total 1000ms from start, 600ms from reset).
    // Without reset: 1000ms > 800ms → would have fired timeout.
    // With reset: 600ms < 800ms → still alive.
    await clock.tickAsync(600);
    await ioFlush();
    assert.ok(!rejected, "Call should NOT have timed out after notification reset");

    // Server sends response.
    respond(capturedSock!, capturedId, { success: true });
    await ioFlush();
    await ioFlush();

    const result = (await callPromise) as { success: boolean };
    assert.equal(result.success, true);
    console.log("  PASS: _queued notification prevents timeout");
  } finally {
    clock.uninstall();
    await bridge.close();
    await server.close();
  }
}

// Test 2: _executing notification resets timeout (same code path).
async function testExecutingPreventsTimeout() {
  let callCount = 0;
  let capturedSock: WS | null = null;
  let capturedId: unknown = null;

  const server = await makeMockServer((sock, msg) => {
    callCount++;
    if (callCount === 1) {
      respond(sock, msg.id, { warmup: true });
    } else {
      capturedSock = sock;
      capturedId = msg.id;
    }
  });

  const bridge = createBridge(`ws://127.0.0.1:${server.port}`, {
    projectPath: "/tmp/test",
    explicitEditorPort: true,
  });

  await bridge.call("warmup", {}, 5000);
  await ioFlush();

  const clock = FakeTimers.install({ toFake: ["setTimeout", "clearTimeout"] });

  try {
    let rejected: Error | null = null;
    const callPromise = bridge.call("echo", {}, 800).then(
      (r) => r,
      (e: Error) => {
        rejected = e;
        throw e;
      },
    );
    await ioFlush();

    await clock.tickAsync(400);
    await ioFlush();

    assert.ok(capturedSock && capturedId);
    notify(capturedSock!, "_executing", capturedId);
    await ioFlush();
    await ioFlush();

    await clock.tickAsync(600);
    await ioFlush();
    assert.ok(!rejected, "Call should NOT have timed out after _executing reset");

    respond(capturedSock!, capturedId, { success: true });
    await ioFlush();
    await ioFlush();

    const result = (await callPromise) as { success: boolean };
    assert.equal(result.success, true);
    console.log("  PASS: _executing notification prevents timeout");
  } finally {
    clock.uninstall();
    await bridge.close();
    await server.close();
  }
}

// Test 3: Without notifications, advancing past timeout rejects the call.
async function testTimeoutWithoutNotifications() {
  let callCount = 0;
  const server = await makeMockServer((sock, msg) => {
    callCount++;
    if (callCount === 1) {
      respond(sock, msg.id, { warmup: true });
    }
    // Second call: never respond.
  });

  const bridge = createBridge(`ws://127.0.0.1:${server.port}`, {
    projectPath: "/tmp/test",
    explicitEditorPort: true,
  });

  await bridge.call("warmup", {}, 5000);
  await ioFlush();

  const clock = FakeTimers.install({ toFake: ["setTimeout", "clearTimeout"] });

  try {
    // Capture the rejection — attach handler immediately to prevent unhandled.
    let rejected: Error | null = null;
    const callPromise = bridge.call("echo", {}, 800).catch((e: Error) => {
      rejected = e;
    });
    await ioFlush();

    // Advance past timeout.
    await clock.tickAsync(801);
    await ioFlush();
    await callPromise;

    assert.ok(rejected, "Call should have timed out");
    assert.ok(
      rejected!.message.includes("timed out") || rejected!.message.includes("TIMEOUT"),
      `Expected timeout, got: ${rejected!.message}`,
    );
    console.log("  PASS: Call correctly times out without notifications");
  } finally {
    clock.uninstall();
    await bridge.close();
    await server.close();
  }
}

// Test 4: Notifications for unknown request IDs are silently ignored.
async function testUnknownRequestIdIgnored() {
  const server = await makeMockServer((sock, msg) => {
    notify(sock, "_queued", 99999); // Wrong ID.
    respond(sock, msg.id, { success: true }); // Correct response.
  });

  const bridge = createBridge(`ws://127.0.0.1:${server.port}`, {
    projectPath: "/tmp/test",
    explicitEditorPort: true,
  });

  try {
    const result = (await bridge.call("echo", {}, 5000)) as { success: boolean };
    assert.equal(result.success, true);
    console.log("  PASS: Notifications for unknown request IDs silently ignored");
  } finally {
    await bridge.close();
    await server.close();
  }
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log("Bridge notification tests (41l-decies):");
  await testQueuedPreventsTimeout();
  await testExecutingPreventsTimeout();
  await testTimeoutWithoutNotifications();
  await testUnknownRequestIdIgnored();
  console.log("All bridge notification tests passed.");
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
