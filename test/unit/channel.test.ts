/**
 * Unit tests for channel.ts — the C-CHAN transport primitive carved out of
 * bridge.ts (C2, the HEADLINE). Exercises the channel state machine in
 * isolation (the bulk Part 11 would have authored, pulled forward) so the
 * verbatim relocation stays byte-equivalent:
 *   1. pending-map correlation — resolve by id; error → RPC_ERROR "<code>: <msg>"
 *   2. _queued/_executing timeout-reset on the pending request
 *   3. attempt=0 resets backoff on a round-trip, NOT on open (the :453 invariant)
 *   4. cold awaitOpenSocket fails fast (CONNECT_FAILED) vs hot parks then resolves
 *   5. call timeout (TIMEOUT after timeoutMs with no response)
 *   6. cooperative cancel — abort → CANCELLED + a _cancel notification {request_id}
 *   7. close() rejects an in-flight pending request AND a parked waiter (CLOSED)
 *
 * Mirrors bridge-notifications.test.ts's makeMockServer (auth + dispatch-by-id)
 * and @sinonjs/fake-timers idiom, plus bridge-version-hook.test.ts's dropClients/
 * authCount + waitFor reconnect idiom. Reconnect-driving cases use REAL timers +
 * waitFor (the proven reconnect pattern); only the established-connection timeout
 * cases fake setTimeout/clearTimeout (mirroring bridge-notifications). Each
 * assertion is genuinely derived (the actual resolved value / rejection / the
 * observed backoff ladder / the captured _cancel frame) — never a fn===fn tautology.
 */

import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WebSocketServer, WebSocket as WS } from "ws";
import type { AddressInfo } from "node:net";
import FakeTimers from "@sinonjs/fake-timers";
import { captureStderr } from "./helpers.js";
import { BridgeError } from "../../src/shared/errors.js";

// Set up a fake token file before importing createChannel so performAuth's
// readToken short-circuits to it (GODOT_MCP_TOKEN_PATH). The runner isolates
// each file in its own subprocess, so this module-scope env mutation can't leak.
const tmpDir = mkdtempSync(join(tmpdir(), "mcp-channel-"));
const tokenPath = join(tmpDir, "mcp_token");
writeFileSync(tokenPath, "test-token-for-unit-tests");
process.env.GODOT_MCP_TOKEN_PATH = tokenPath;

const { createChannel } = await import("../../src/transport/channel.js");

// ── Mock toolkit server (answers auth, dispatches RPCs by id) ─────────

interface ReceivedMsg {
  id?: unknown;
  method?: string;
  params?: Record<string, unknown>;
}

interface MockServer {
  port: number;
  /** Auth handshakes answered (1 per connect/reconnect). */
  authCount: () => number;
  /** Every non-auth frame the server received (RPCs + notifications like _cancel). */
  received: () => ReceivedMsg[];
  /** Forcibly terminate every connected client → drives a hot reconnect. */
  dropClients: () => void;
  close: () => Promise<void>;
}

function makeMockServer(handler?: (sock: WS, msg: ReceivedMsg) => void): Promise<MockServer> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    const sockets = new Set<WS>();
    const received: ReceivedMsg[] = [];
    let auths = 0;
    wss.on("listening", () => {
      resolve({
        port: (wss.address() as AddressInfo).port,
        authCount: () => auths,
        received: () => received,
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
        let msg: ReceivedMsg & { auth?: unknown };
        try {
          msg = JSON.parse(data.toString()) as ReceivedMsg & { auth?: unknown };
        } catch {
          return;
        }
        if (msg.auth !== undefined) {
          auths++;
          sock.send(JSON.stringify({ authed: true, godot_version: "4.5", version: "1.0.0" }));
          return;
        }
        received.push(msg);
        if (msg.id != null && handler) handler(sock, msg);
      });
    });
  });
}

function respond(sock: WS, id: unknown, result: unknown): void {
  sock.send(JSON.stringify({ jsonrpc: "2.0", id, result }));
}

function respondError(sock: WS, id: unknown, code: number, message: string): void {
  sock.send(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }));
}

function notify(sock: WS, method: string, requestId: unknown): void {
  sock.send(JSON.stringify({ jsonrpc: "2.0", method, params: { request_id: requestId } }));
}

/** Wait for real I/O (microtasks + next event-loop tick). */
function ioFlush(): Promise<void> {
  return new Promise((r) => setImmediate(r));
}

/** Drain real I/O until pred() holds (setImmediate is NOT faked). */
async function flushUntil(pred: () => boolean, label: string, maxFlushes = 2000): Promise<void> {
  for (let i = 0; i < maxFlushes; i++) {
    if (pred()) return;
    await ioFlush();
  }
  throw new Error(`flushUntil exhausted: ${label}`);
}

/** Poll a condition under REAL timers (the unref'd reconnect timer stays live). */
async function waitFor(cond: () => boolean, label: string, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error(`waitFor timed out: ${label}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

// ── 1. pending-map correlation (resolve by id; error → RPC_ERROR) ─────

async function testPendingMapCorrelation() {
  const server = await makeMockServer((sock, msg) => {
    if (msg.method === "boom") respondError(sock, msg.id, -32001, "kaboom");
    else respond(sock, msg.id, { echoed: msg.params });
  });
  const ch = createChannel(`ws://127.0.0.1:${server.port}`, undefined, undefined, undefined);
  try {
    // The response is correlated back to THIS call by id and resolves its result.
    const result = (await ch.call("echo", { p: 1 })) as { echoed: { p: number } };
    assert.deepEqual(result, { echoed: { p: 1 } }, "response correlates by id → resolves the result");

    // An error response rejects with RPC_ERROR carrying "<code>: <message>".
    await assert.rejects(
      ch.call("boom"),
      (err: unknown) => err instanceof BridgeError && err.code === "RPC_ERROR" && err.message === "-32001: kaboom",
      "error response → RPC_ERROR '<code>: <message>'",
    );
    console.log("  PASS: pending-map correlation (resolve by id; error → RPC_ERROR)");
  } finally {
    await ch.close();
    await server.close();
  }
}

// ── 2. _queued/_executing notification resets the pending timeout ─────

async function testQueuedResetsTimeout() {
  let callCount = 0;
  let capturedSock: WS | null = null;
  let capturedId: unknown = null;
  const server = await makeMockServer((sock, msg) => {
    callCount++;
    if (callCount === 1) {
      respond(sock, msg.id, { warmup: true }); // complete auth + reset attempt
    } else {
      capturedSock = sock; // 2nd call: capture, do not respond yet
      capturedId = msg.id;
    }
  });
  const ch = createChannel(`ws://127.0.0.1:${server.port}`, undefined, undefined, undefined);
  await ch.call("warmup", {}, 5000); // REAL timers so auth completes
  await ioFlush();

  const clock = FakeTimers.install({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    let resolved = false;
    let rejected: unknown = null;
    const callPromise = ch.call("echo", {}, 800).then(
      (r) => {
        resolved = true;
        return r;
      },
      (e: unknown) => {
        rejected = e;
        throw e;
      },
    );
    await ioFlush();

    await clock.tickAsync(400); // halfway to the 800ms deadline
    await ioFlush();
    assert.ok(!resolved && !rejected, "still pending at 400ms");
    assert.ok(capturedSock && capturedId, "server received the RPC");

    notify(capturedSock!, "_queued", capturedId); // resets the pending timer
    await ioFlush();
    await ioFlush();

    await clock.tickAsync(600); // 1000ms total > 800ms original; reset keeps it alive
    await ioFlush();
    assert.ok(!rejected, "did NOT time out after the _queued reset");

    respond(capturedSock!, capturedId, { success: true });
    await ioFlush();
    await ioFlush();
    const result = (await callPromise) as { success: boolean };
    assert.equal(result.success, true);
    console.log("  PASS: _queued notification resets the pending timeout");
  } finally {
    clock.uninstall();
    await ch.close();
    await server.close();
  }
}

// ── 3. backoff resets on a round-trip, NOT on open (the :453 invariant) ─

async function testBackoffResetsOnRoundTrip() {
  const server = await makeMockServer((sock, msg) => respond(sock, msg.id, { ok: true }));
  const ch = createChannel(`ws://127.0.0.1:${server.port}`, undefined, undefined, undefined);
  await ch.call("warmup", {}, 5000); // connect + auth + round-trip → attempt reset to 0

  const cap = captureStderr();
  try {
    const attempt1 = /reconnect in 1000ms \(attempt 1\)/g;
    const attempt2 = /reconnect in 2000ms \(attempt 2\)/g;
    const count = (re: RegExp) => (cap.output().match(re) ?? []).length;

    // Drop #1 (attempt 0) → schedules 1000ms / attempt 1.
    server.dropClients();
    await waitFor(() => count(attempt1) >= 1, "drop#1 schedules attempt 1");
    await waitFor(() => server.authCount() >= 2, "reconnect #1 completes");

    // Drop #2 WITHOUT a round-trip (a reconnect-open alone must NOT reset) →
    // climbs to 2000ms / attempt 2.
    server.dropClients();
    await waitFor(() => count(attempt2) >= 1, "drop#2 climbs to attempt 2");
    await waitFor(() => server.authCount() >= 3, "reconnect #2 completes");

    // A successful round-trip resets the backoff to attempt 0.
    await ch.call("ping", {}, 5000);

    // Drop #3 AFTER the round-trip → back to 1000ms / attempt 1 (NOT attempt 3).
    server.dropClients();
    await waitFor(() => count(attempt1) >= 2, "drop#3 resets to attempt 1");

    const out = cap.output();
    assert.equal(count(attempt1), 2, "attempt-1/1000ms rung fires twice (initial + post-round-trip reset)");
    assert.equal(count(attempt2), 1, "attempt-2/2000ms rung fired once (climbed across a reconnect-open)");
    assert.ok(!/\(attempt 3\)/.test(out), "never reached attempt 3 — the round-trip reset the backoff");
    console.log("  PASS: backoff resets on a round-trip, not on open (ladder 1000→2000, then reset to 1000)");
  } finally {
    cap.restore();
    await ch.close();
    await server.close();
  }
}

// ── 4. cold awaitOpenSocket fails fast vs hot parks then resolves ─────

async function testColdVsHotAwaitOpenSocket() {
  // Cold: never connected → first call surfaces CONNECT_FAILED immediately,
  // not after the 10s hot-wait ceiling.
  {
    const probe = await makeMockServer();
    const deadPort = probe.port;
    await probe.close(); // free the port → connects get refused
    const ch = createChannel(`ws://127.0.0.1:${deadPort}`, undefined, undefined, undefined);
    try {
      await assert.rejects(
        ch.call("x", {}, 30000),
        (err: unknown) => err instanceof BridgeError && err.code === "CONNECT_FAILED",
        "cold call against a dead port → CONNECT_FAILED",
      );
    } finally {
      await ch.close();
    }
  }

  // Hot: connected then dropped → a subsequent call PARKS (does not fail fast)
  // and resolves once the reconnect succeeds.
  {
    const server = await makeMockServer((sock, msg) => respond(sock, msg.id, { ok: true }));
    const ch = createChannel(`ws://127.0.0.1:${server.port}`, undefined, undefined, undefined);
    await ch.call("warmup", {}, 5000); // hasConnectedOnce = true
    const cap = captureStderr();
    try {
      server.dropClients();
      await waitFor(() => cap.output().includes("(attempt 1)"), "reconnect scheduled (hot)");

      let done = false;
      let failed: unknown = null;
      const p = ch.call("after-reconnect", {}, 30000).then(
        (r) => {
          done = true;
          return r;
        },
        (e: unknown) => {
          failed = e;
          throw e;
        },
      );
      // Cold would have rejected by now; hot must still be parked.
      await new Promise((r) => setTimeout(r, 50));
      assert.ok(!done && !failed, "hot call parks (no fast CONNECT_FAILED) while disconnected");

      // The real 1000ms backoff timer fires, the reconnect succeeds, and the
      // parked waiter resolves → the call completes against the new socket.
      const r = (await p) as { ok: boolean };
      assert.equal(r.ok, true, "parked call resolves via the reconnected socket");
      console.log("  PASS: cold awaitOpenSocket fails fast; hot parks then resolves on reconnect");
    } finally {
      cap.restore();
      await ch.close();
      await server.close();
    }
  }
}

// ── 5. call timeout (TIMEOUT after timeoutMs with no response) ────────

async function testCallTimeout() {
  let callCount = 0;
  const server = await makeMockServer((sock, msg) => {
    callCount++;
    if (callCount === 1) respond(sock, msg.id, { warmup: true });
    // 2nd call: never respond.
  });
  const ch = createChannel(`ws://127.0.0.1:${server.port}`, undefined, undefined, undefined);
  await ch.call("warmup", {}, 5000);
  await ioFlush();

  const clock = FakeTimers.install({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    let rejected: unknown = null;
    const p = ch.call("hang", {}, 800).catch((e: unknown) => {
      rejected = e;
    });
    await ioFlush();
    await clock.tickAsync(801); // cross the deadline
    await ioFlush();
    await p;
    assert.ok(
      rejected instanceof BridgeError && rejected.code === "TIMEOUT",
      `expected TIMEOUT, got ${String(rejected)}`,
    );
    assert.ok((rejected as BridgeError).message.includes("timed out after 800ms"));
    console.log("  PASS: call rejects TIMEOUT after timeoutMs with no response");
  } finally {
    clock.uninstall();
    await ch.close();
    await server.close();
  }
}

// ── 6. cooperative cancel — abort → CANCELLED + a _cancel notification ─

async function testCooperativeCancel() {
  let capturedId: unknown = null;
  const server = await makeMockServer((_sock, msg) => {
    capturedId = msg.id; // capture the RPC id but NEVER respond → force the cancel path
  });
  const ch = createChannel(`ws://127.0.0.1:${server.port}`, undefined, undefined, undefined);
  const controller = new AbortController();
  try {
    let rejected: unknown = null;
    const p = ch.call("hang", {}, 30000, controller.signal).catch((e: unknown) => {
      rejected = e;
    });
    await flushUntil(() => capturedId != null, "server received the RPC");

    controller.abort(); // → cancelPending: reject CANCELLED + send the _cancel notification
    await p;
    assert.ok(
      rejected instanceof BridgeError && rejected.code === "CANCELLED",
      `expected CANCELLED, got ${String(rejected)}`,
    );

    await flushUntil(() => server.received().some((m) => m.method === "_cancel"), "_cancel notification delivered");
    const cancelMsg = server.received().find((m) => m.method === "_cancel");
    assert.ok(cancelMsg, "_cancel notification received");
    assert.equal(
      (cancelMsg!.params as { request_id?: unknown }).request_id,
      capturedId,
      "_cancel carries {request_id} of the cancelled call",
    );
    console.log("  PASS: abort rejects CANCELLED and emits a _cancel notification with request_id");
  } finally {
    await ch.close();
    await server.close();
  }
}

// ── 7. close() rejects an in-flight pending request AND a parked waiter ─

async function testCloseRejectsPendingAndWaiters() {
  // 7a — a pending request (connected, awaiting a response) → CLOSED.
  {
    const server = await makeMockServer((_sock, _msg) => {
      // capture but never respond → leaves the call pending
    });
    const ch = createChannel(`ws://127.0.0.1:${server.port}`, undefined, undefined, undefined);
    try {
      let pendingRej: unknown = null;
      const pendingCall = ch.call("hang", {}, 30000).catch((e: unknown) => {
        pendingRej = e;
      });
      await flushUntil(() => server.received().some((m) => m.method === "hang"), "RPC in flight (pending populated)");
      await ch.close();
      await pendingCall;
      assert.ok(
        pendingRej instanceof BridgeError && pendingRej.code === "CLOSED",
        `pending → CLOSED, got ${String(pendingRej)}`,
      );
    } finally {
      await server.close();
    }
  }

  // 7b — a parked open-waiter (hot reconnect in flight) → CLOSED.
  {
    const server = await makeMockServer((sock, msg) => respond(sock, msg.id, { ok: true }));
    const ch = createChannel(`ws://127.0.0.1:${server.port}`, undefined, undefined, undefined);
    await ch.call("warmup", {}, 5000); // hasConnectedOnce = true
    const cap = captureStderr();
    try {
      server.dropClients();
      await waitFor(() => cap.output().includes("(attempt 1)"), "reconnect scheduled");

      let waiterRej: unknown = null;
      const parked = ch.call("after", {}, 30000).catch((e: unknown) => {
        waiterRej = e;
      });
      await new Promise((r) => setTimeout(r, 20)); // let it park as a waiter
      await ch.close(); // rejects the parked waiter before the 1000ms reconnect fires
      await parked;
      assert.ok(
        waiterRej instanceof BridgeError && waiterRej.code === "CLOSED",
        `waiter → CLOSED, got ${String(waiterRej)}`,
      );
    } finally {
      cap.restore();
      await server.close();
    }
  }

  console.log("  PASS: close() rejects both a pending request and a parked waiter with CLOSED");
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log("channel tests (concern 068 — C2):");
  await testPendingMapCorrelation();
  await testQueuedResetsTimeout();
  await testBackoffResetsOnRoundTrip();
  await testColdVsHotAwaitOpenSocket();
  await testCallTimeout();
  await testCooperativeCancel();
  await testCloseRejectsPendingAndWaiters();
  console.log("All 7 channel tests passed.");
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
