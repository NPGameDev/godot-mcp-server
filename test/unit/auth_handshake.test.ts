/**
 * Unit tests for auth_handshake.ts — the C-AUTH leaf carved out of bridge.ts (C1).
 * Pins the §10.1 auth-WIRE contract so the extraction stays byte-equivalent:
 * the `{ auth, version }` frame, the `{ authed, godot_version, version }` →
 * `{ godotVersion, toolkitVersion }` mapping (missing fields → null), the 5 s
 * AUTH_TIMEOUT_MS timeout, listener cleanup() on settle, the close-during-auth
 * reject, and the non-JSON-frame ignore.
 *
 * Mirrors bridge-version-hook.test.ts's infra: a real loopback WebSocketServer
 * and a real client ws, with authenticate(clientWs, token) driven directly.
 * Each assertion is genuinely derived (the actual sent frame / the actual
 * resolved shape / the actual rejection) — never a fn===fn tautology.
 */

import assert from "node:assert/strict";
import { WebSocketServer, WebSocket as WS } from "ws";
import type { AddressInfo } from "node:net";
import FakeTimers from "@sinonjs/fake-timers";
import { authenticate } from "../../src/auth_handshake.js";
import { BridgeError } from "../../src/errors.js";
import { getServerVersion } from "../../src/version.js";

// ── Connected real-socket pair ───────────────────────────────────────
// Stand up a loopback WebSocketServer, open a real client to it, and resolve
// once BOTH ends are connected — so a case can wire the server socket's reply
// behavior and then call authenticate(client, …) against a live connection.

interface Pair {
  client: WS;
  server: WS;
  closeAll: () => Promise<void>;
}

function connectPair(): Promise<Pair> {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    let server: WS | null = null;
    let client: WS | null = null;

    const closeAll = (): Promise<void> =>
      new Promise<void>((res) => {
        try {
          client?.terminate();
          server?.terminate();
        } catch {
          // already closed — ignore
        }
        wss.close(() => res());
      });

    const tryResolve = (): void => {
      if (server && client) resolve({ client, server, closeAll });
    };

    wss.on("connection", (sock) => {
      server = sock;
      tryResolve();
    });
    wss.on("listening", () => {
      const { port } = wss.address() as AddressInfo;
      const c = new WS(`ws://127.0.0.1:${port}`);
      // Keep an error listener attached so a teardown-time error never throws on
      // the EventEmitter; reject is a no-op once the pair has resolved.
      c.on("error", reject);
      c.on("open", () => {
        client = c;
        tryResolve();
      });
    });
  });
}

// ── 1. SENDS the right frame ─────────────────────────────────────────

async function testSendsFrame() {
  const { client, server, closeAll } = await connectPair();
  try {
    // Capture the FIRST frame the server receives, then reply so authenticate
    // resolves cleanly.
    const framePromise = new Promise<Record<string, unknown>>((resolve) => {
      server.once("message", (data) => {
        resolve(JSON.parse(data.toString()) as Record<string, unknown>);
        server.send(JSON.stringify({ authed: true, godot_version: "4.5", version: "1.0.0" }));
      });
    });
    const authPromise = authenticate(client, "tok-123");
    const frame = await framePromise;
    assert.deepEqual(
      frame,
      { auth: "tok-123", version: getServerVersion() },
      "sends exactly { auth: <token>, version: getServerVersion() }",
    );
    await authPromise; // settles cleanly
    console.log("  PASS: sends { auth, version: getServerVersion() } as the first frame");
  } finally {
    await closeAll();
  }
}

// ── 2. resolves the mapped shape (+ missing fields → null) ───────────

async function testResolvesMappedShape() {
  // 2a — full fields map through verbatim.
  {
    const { client, server, closeAll } = await connectPair();
    try {
      server.once("message", () => {
        server.send(JSON.stringify({ authed: true, godot_version: "4.5", version: "1.0.0" }));
      });
      const resp = await authenticate(client, "tok");
      assert.deepEqual(
        resp,
        { godotVersion: "4.5", toolkitVersion: "1.0.0" },
        "maps godot_version/version → godotVersion/toolkitVersion",
      );
    } finally {
      await closeAll();
    }
  }
  // 2b — absent fields coerce to null (the `?? null` branches).
  {
    const { client, server, closeAll } = await connectPair();
    try {
      server.once("message", () => {
        server.send(JSON.stringify({ authed: true })); // no godot_version, no version
      });
      const resp = await authenticate(client, "tok");
      assert.deepEqual(resp, { godotVersion: null, toolkitVersion: null }, "missing fields → null");
    } finally {
      await closeAll();
    }
  }
  console.log("  PASS: resolves the mapped shape; missing fields → null");
}

// ── 3. the 5 s AUTH_TIMEOUT_MS timeout ───────────────────────────────

async function testTimeout() {
  const { client, closeAll } = await connectPair();
  // Server never replies → only the auth timer can settle the promise. Fake just
  // setTimeout/clearTimeout (socket I/O stays real, as in bridge-notifications).
  const clock = FakeTimers.install({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    let rejected: unknown = null;
    const p = authenticate(client, "tok").catch((e: unknown) => {
      rejected = e;
    });
    // Just below the deadline: still pending.
    await clock.tickAsync(4999);
    assert.equal(rejected, null, "not rejected before 5 s");
    // Cross the 5 s deadline → the AUTH_TIMEOUT_MS timer fires.
    await clock.tickAsync(1);
    await p;
    assert.ok(rejected instanceof BridgeError, `expected a BridgeError, got ${String(rejected)}`);
    assert.equal((rejected as BridgeError).code, "AUTH_FAILED");
    assert.equal((rejected as BridgeError).message, "auth handshake timed out");
    console.log("  PASS: rejects BridgeError(AUTH_FAILED, 'auth handshake timed out') after 5 s");
  } finally {
    clock.uninstall();
    await closeAll();
  }
}

// ── 4. cleanup() removes both listeners after a resolve ──────────────

async function testCleanup() {
  const { client, server, closeAll } = await connectPair();
  try {
    server.once("message", () => {
      server.send(JSON.stringify({ authed: true, godot_version: "4.5", version: "1.0.0" }));
    });
    await authenticate(client, "tok");
    // cleanup() ran on resolve → both of authenticate's own listeners are gone.
    assert.equal(client.listenerCount("message"), 0, "message listener removed after resolve");
    assert.equal(client.listenerCount("close"), 0, "close listener removed after resolve");
    console.log("  PASS: cleanup() removes the message + close listeners after a resolve");
  } finally {
    await closeAll();
  }
}

// ── 5. close-during-auth reject ──────────────────────────────────────

async function testCloseDuringAuth() {
  const { client, server, closeAll } = await connectPair();
  try {
    // Server closes mid-handshake instead of answering.
    server.once("message", () => {
      server.close();
    });
    await assert.rejects(
      authenticate(client, "tok"),
      (err: unknown) =>
        err instanceof BridgeError &&
        err.code === "AUTH_FAILED" &&
        err.message.includes("server closed connection during auth"),
      "rejects when the peer closes during the handshake",
    );
    console.log("  PASS: rejects 'server closed connection during auth' on a mid-handshake close");
  } finally {
    await closeAll();
  }
}

// ── 6. non-JSON frame ignored, then the real reply resolves ──────────

async function testNonJsonIgnore() {
  const { client, server, closeAll } = await connectPair();
  try {
    server.once("message", () => {
      // A garbage non-JSON frame (must be ignored), then the real reply.
      server.send("<<not json>>");
      server.send(JSON.stringify({ authed: true, godot_version: "4.6", version: "1.2.3" }));
    });
    const resp = await authenticate(client, "tok");
    assert.deepEqual(
      resp,
      { godotVersion: "4.6", toolkitVersion: "1.2.3" },
      "garbage frame ignored; the subsequent valid reply resolves",
    );
    console.log("  PASS: non-JSON frame ignored, then the real reply resolves");
  } finally {
    await closeAll();
  }
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log("auth_handshake tests (concern 068 — C1):");
  await testSendsFrame();
  await testResolvesMappedShape();
  await testTimeout();
  await testCleanup();
  await testCloseDuringAuth();
  await testNonJsonIgnore();
  console.log("All 6 auth_handshake tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
