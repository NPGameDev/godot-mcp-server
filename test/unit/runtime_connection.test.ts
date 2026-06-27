/**
 * Unit tests for runtime_connection.ts — the playtest runtime-connection
 * aggregate carved out of bridge.ts (concern 068, C4 — the integrator).
 *
 * Drives the aggregate through its injected `deps` seam (mirrors
 * extension_registrar.test.ts's fake-injection idiom): a fake createChannel
 * returning a controllable channel (call resolves/rejects on command, close is
 * a spy), a fake createHeartbeat returning start/stop spies, and a fake registry
 * whose six reader fns return scripted values (with watchRegistry capturing the
 * onDiscovered/onRemoved callbacks so a test can drive discovery). No real
 * WebSocket, no real registry file — every assertion is a genuinely derived
 * outcome (channel URLs, call/close counts, heartbeat start/stop counts,
 * resolved values, mapped error codes), never a fn===fn tautology.
 *
 * Groups (design 068 §5 C4):
 *   1. discovery branches — explicit-port static channel; no-port/no-projectPath → GAME_NOT_RUNNING
 *   2. the watcher — onDiscovered swap/port/heartbeat.start/waiter-resolve; onRemoved heartbeat.stop/close/null
 *   3. callRuntime paths — fast / normal / explicit + the CONNECT_FAILED/DISCONNECTED → GAME_NOT_RUNNING mapping
 *   4. clearRuntime — heartbeat.stop + close + null both
 *   5. waitForRuntimeConnection timeout — no-projectPath → null; deadline+no-discovery → null after the timer
 */

import assert from "node:assert/strict";
import FakeTimers from "@sinonjs/fake-timers";
import { createRuntimeConnection, type RuntimeConnectionDeps } from "../../src/runtime_connection.js";
import { BridgeError } from "../../src/errors.js";
import type { Channel } from "../../src/channel.js";

// ── Fake collaborators (the deps seam) ───────────────────────────────

interface FakeChannel extends Channel {
  url: string;
  closeCalls: number;
  callLog: Array<{ method: string; params: unknown; timeoutMs?: number }>;
}

type WatcherCbs = {
  onDiscovered: (projectPath: string, port: number) => void;
  onRemoved: (projectPath: string) => void;
};

/** Build a full deps seam plus the controls a test drives it with. */
function makeDeps() {
  const channels: FakeChannel[] = [];
  let callImpl: (method: string) => Promise<unknown> = () => Promise.resolve({ ok: true });

  const createChannel = ((url: string): FakeChannel => {
    const ch: FakeChannel = {
      url,
      closeCalls: 0,
      callLog: [],
      call(method: string, params?: unknown, timeoutMs?: number) {
        ch.callLog.push({ method, params, timeoutMs });
        return callImpl(method);
      },
      close() {
        ch.closeCalls++;
        return Promise.resolve();
      },
    };
    channels.push(ch);
    return ch;
  }) as unknown as RuntimeConnectionDeps["createChannel"];

  const hb = { startCalls: 0, stopCalls: 0 };
  const createHeartbeat = (() => ({
    start() {
      hb.startCalls++;
    },
    stop() {
      hb.stopCalls++;
    },
  })) as unknown as RuntimeConnectionDeps["createHeartbeat"];

  let watcher: WatcherCbs | null = null;
  // Scriptable registry returns (functions so a test can vary them per call).
  const reg = {
    discover: (() => null) as (projectPath: string) => number | null,
    cached: (() => null) as (projectPath: string) => number | null,
    watcherActive: false,
    unwatchCalls: 0,
  };
  const registry: RuntimeConnectionDeps["registry"] = {
    discoverRuntime: (projectPath: string) => reg.discover(projectPath),
    normalizePath: (p: string) => p,
    watchRegistry: (cbs) => {
      watcher = cbs;
    },
    unwatchRegistry: () => {
      reg.unwatchCalls++;
    },
    isWatcherActive: () => reg.watcherActive,
    getCachedRuntimePort: (projectPath: string) => reg.cached(projectPath),
  };

  const deps: RuntimeConnectionDeps = { createChannel, createHeartbeat, registry };
  return {
    deps,
    channels,
    hb,
    reg,
    setCallImpl: (fn: (method: string) => Promise<unknown>) => {
      callImpl = fn;
    },
    watcherRegistered: () => watcher !== null,
    fireDiscovered: (projectPath: string, port: number) => watcher!.onDiscovered(projectPath, port),
    fireRemoved: (projectPath: string) => watcher!.onRemoved(projectPath),
  };
}

const isGameNotRunning = (e: unknown): e is BridgeError => e instanceof BridgeError && e.code === "GAME_NOT_RUNNING";

// ── 1. discovery branches ─────────────────────────────────────────────

async function testDiscoveryBranches() {
  // Explicit port → a static channel built at construct, cachedRuntimePort set.
  {
    const t = makeDeps();
    const rc = createRuntimeConnection({ explicitRuntimePort: "9999" }, t.deps);
    assert.equal(t.channels.length, 1, "explicit port builds a static channel at construct");
    assert.equal(t.channels[0].url, "ws://127.0.0.1:9999", "static channel targets the explicit port");
    assert.equal(t.watcherRegistered(), false, "explicit port skips the registry watcher");

    t.setCallImpl(() => Promise.resolve({ pong: true }));
    const r = await rc.callRuntime("ping");
    assert.deepEqual(r, { pong: true }, "callRuntime routes to the static channel");
    assert.equal(t.channels[0].callLog.length, 1, "the explicit-port call hit the static channel");
  }

  // No explicit port + no projectPath → callRuntime rejects GAME_NOT_RUNNING.
  {
    const t = makeDeps();
    const rc = createRuntimeConnection({}, t.deps);
    assert.equal(t.channels.length, 0, "no channel constructed without a port or projectPath");
    await assert.rejects(
      () => rc.callRuntime("ping"),
      (e: unknown) => isGameNotRunning(e) && /no project path/.test(e.message),
      "no port + no projectPath → GAME_NOT_RUNNING",
    );
  }
  console.log("  PASS: discovery branches (explicit-port static channel; no-port/no-path → GAME_NOT_RUNNING)");
}

// ── 2. the registry watcher ───────────────────────────────────────────

async function testWatcher() {
  const t = makeDeps();
  const rc = createRuntimeConnection({ projectPath: "/proj" }, t.deps);
  assert.equal(t.watcherRegistered(), true, "projectPath (no explicit port) registers the watcher");
  assert.equal(t.channels.length, 0, "no channel before discovery");

  // A non-matching project is ignored.
  t.fireDiscovered("/other", 4321);
  assert.equal(t.channels.length, 0, "discovery for a different project is ignored");
  assert.equal(t.hb.startCalls, 0, "no heartbeat start for a non-matching project");

  // A pending waiter must resolve on discovery.
  const waiterP = rc.waitForRuntimeConnection(60_000);

  t.fireDiscovered("/proj", 7000);
  assert.equal(t.channels.length, 1, "onDiscovered created a channel");
  assert.equal(t.channels[0].url, "ws://127.0.0.1:7000", "channel targets the discovered port");
  assert.equal(t.hb.startCalls, 1, "onDiscovered started the heartbeat");
  assert.deepEqual(await waiterP, { port: 7000 }, "the pending waiter resolved with the discovered port");

  // onRemoved tears the channel down.
  t.fireRemoved("/proj");
  assert.equal(t.hb.stopCalls, 1, "onRemoved stopped the heartbeat");
  assert.equal(t.channels[0].closeCalls, 1, "onRemoved closed the channel");
  console.log("  PASS: watcher onDiscovered swap/port/heartbeat-start/waiter-resolve; onRemoved stop/close/null");
}

// ── 3. callRuntime paths ──────────────────────────────────────────────

async function testCallRuntimePaths() {
  // 3a. fast path, watcher INACTIVE → discoverRuntime supplies the port.
  {
    const t = makeDeps();
    const rc = createRuntimeConnection({ projectPath: "/proj" }, t.deps);
    t.reg.watcherActive = false;
    t.reg.discover = () => 7100;
    t.setCallImpl(() => Promise.resolve({ pong: 1 }));
    const r = await rc.callRuntime("ping");
    assert.deepEqual(r, { pong: 1 }, "fast path returns the channel result");
    assert.equal(t.channels.length, 1, "fast path created exactly one channel");
    assert.equal(t.channels[0].url, "ws://127.0.0.1:7100", "fast path channel targets the discovered port");
  }

  // 3b. fast path, watcher ACTIVE → getCachedRuntimePort for freshPort, discoverRuntime for the disk-confirm.
  {
    const t = makeDeps();
    const rc = createRuntimeConnection({ projectPath: "/proj" }, t.deps);
    t.reg.watcherActive = true;
    t.reg.cached = () => 7200;
    t.reg.discover = () => 7200;
    t.setCallImpl(() => Promise.resolve("ok"));
    await rc.callRuntime("ping");
    assert.equal(
      t.channels[0].url,
      "ws://127.0.0.1:7200",
      "watcher-active fast path uses the cached then disk-confirmed port",
    );
  }

  // 3c. fast path, registry cache has a port but the disk re-read is empty → "game stopped".
  {
    const t = makeDeps();
    const rc = createRuntimeConnection({ projectPath: "/proj" }, t.deps);
    t.reg.watcherActive = true;
    t.reg.cached = () => 7300; // freshPort non-null
    t.reg.discover = () => null; // disk-confirm null
    await assert.rejects(
      () => rc.callRuntime("ping"),
      (e: unknown) => isGameNotRunning(e) && /game stopped/.test(e.message),
      "cached port but empty disk re-read → GAME_NOT_RUNNING (game stopped)",
    );
    assert.equal(t.channels.length, 0, "no channel created when the disk-confirm fails");
  }

  // 3d. fast path, no port anywhere → "no runtime_port in registry".
  {
    const t = makeDeps();
    const rc = createRuntimeConnection({ projectPath: "/proj" }, t.deps);
    t.reg.watcherActive = false;
    t.reg.discover = () => null;
    await assert.rejects(
      () => rc.callRuntime("ping"),
      (e: unknown) => isGameNotRunning(e) && /no runtime_port in registry/.test(e.message),
      "no port discovered → GAME_NOT_RUNNING",
    );
  }

  // 3e. normal path → port changed → close old, create new.
  {
    const t = makeDeps();
    const rc = createRuntimeConnection({ projectPath: "/proj" }, t.deps);
    t.reg.watcherActive = false;
    t.reg.discover = () => 7100;
    t.setCallImpl(() => Promise.resolve(1));
    await rc.callRuntime("a"); // fast path → channel[0] @ 7100, cachedPort 7100
    assert.equal(t.channels.length, 1, "first call created the channel");

    t.reg.watcherActive = true;
    t.reg.cached = () => 7400; // normal path sees a different port
    await rc.callRuntime("b");
    assert.equal(t.channels[0].closeCalls, 1, "normal path closed the old channel on port change");
    assert.equal(t.channels.length, 2, "normal path created a new channel for the new port");
    assert.equal(t.channels[1].url, "ws://127.0.0.1:7400", "the new channel targets the changed port");
  }

  // 3f. normal path → registry empties → close stale + GAME_NOT_RUNNING.
  {
    const t = makeDeps();
    const rc = createRuntimeConnection({ projectPath: "/proj" }, t.deps);
    t.reg.watcherActive = false;
    t.reg.discover = () => 7100;
    t.setCallImpl(() => Promise.resolve(1));
    await rc.callRuntime("a"); // channel @ 7100

    t.reg.watcherActive = true;
    t.reg.cached = () => null; // registry empty now
    await assert.rejects(
      () => rc.callRuntime("b"),
      isGameNotRunning,
      "normal path with an empty registry → GAME_NOT_RUNNING",
    );
    assert.equal(t.channels[0].closeCalls, 1, "stale channel closed when the registry empties");
  }

  // 3g. explicit-port path → CONNECT_FAILED maps to GAME_NOT_RUNNING.
  {
    const t = makeDeps();
    const rc = createRuntimeConnection({ explicitRuntimePort: "9000" }, t.deps);
    t.setCallImpl(() => Promise.reject(new BridgeError("CONNECT_FAILED", "boom")));
    await assert.rejects(
      () => rc.callRuntime("ping"),
      (e: unknown) => isGameNotRunning(e) && /127\.0\.0\.1:9000/.test(e.message),
      "explicit-port CONNECT_FAILED → GAME_NOT_RUNNING",
    );
  }

  // 3h. registry path → a post-connect DISCONNECTED maps to GAME_NOT_RUNNING and tears the channel down.
  {
    const t = makeDeps();
    const rc = createRuntimeConnection({ projectPath: "/proj" }, t.deps);
    t.reg.watcherActive = false;
    t.reg.discover = () => 7100;
    t.setCallImpl(() => Promise.resolve(1));
    await rc.callRuntime("a"); // channel @ 7100, cachedPort 7100

    t.reg.watcherActive = true;
    t.reg.cached = () => 7100; // same port → no swap
    t.setCallImpl(() => Promise.reject(new BridgeError("DISCONNECTED", "drop")));
    await assert.rejects(
      () => rc.callRuntime("b"),
      (e: unknown) => isGameNotRunning(e) && /not responding/.test(e.message),
      "post-call DISCONNECTED → GAME_NOT_RUNNING",
    );
    assert.equal(t.channels[0].closeCalls, 1, "the failed channel is closed before the mapped rejection");
  }
  console.log(
    "  PASS: callRuntime fast/normal/explicit paths + CONNECT_FAILED/DISCONNECTED → GAME_NOT_RUNNING mapping",
  );
}

// ── 4. clearRuntime ───────────────────────────────────────────────────

async function testClearRuntime() {
  const t = makeDeps();
  const rc = createRuntimeConnection({ projectPath: "/proj" }, t.deps);
  t.reg.watcherActive = false;
  t.reg.discover = () => 7100;
  t.setCallImpl(() => Promise.resolve(1));
  await rc.callRuntime("warm"); // establish a channel @ 7100
  assert.equal(t.channels.length, 1, "precondition: a runtime channel exists");

  const stopBefore = t.hb.stopCalls;
  rc.clearRuntime();
  assert.equal(t.hb.stopCalls, stopBefore + 1, "clearRuntime stopped the heartbeat");
  assert.equal(t.channels[0].closeCalls, 1, "clearRuntime closed the channel");

  // Both nulled → the next call falls back to the fast path (which now finds nothing).
  t.reg.discover = () => null;
  await assert.rejects(
    () => rc.callRuntime("again"),
    isGameNotRunning,
    "after clearRuntime, callRuntime restarts discovery",
  );
  console.log("  PASS: clearRuntime stops the heartbeat, closes + nulls the channel");
}

// ── 5. waitForRuntimeConnection timeout ───────────────────────────────

async function testWaitForRuntimeConnection() {
  // No projectPath → immediate null.
  {
    const t = makeDeps();
    const rc = createRuntimeConnection({}, t.deps);
    assert.equal(await rc.waitForRuntimeConnection(5000), null, "no projectPath → immediate null");
  }

  // Deadline elapses with no discovery → resolves null after the timer.
  {
    const clock = FakeTimers.install({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const t = makeDeps();
      const rc = createRuntimeConnection({ projectPath: "/proj" }, t.deps);
      const p = rc.waitForRuntimeConnection(5000);
      let resolved = false;
      let value: unknown = "unset";
      void p.then((v) => {
        resolved = true;
        value = v;
      });
      await clock.tickAsync(4999);
      assert.equal(resolved, false, "still pending just before the deadline");
      await clock.tickAsync(1);
      assert.equal(resolved, true, "resolved at the deadline");
      assert.equal(value, null, "the timeout resolves null");
    } finally {
      clock.uninstall();
    }
  }
  console.log("  PASS: waitForRuntimeConnection (no-projectPath → null; deadline+no-discovery → null)");
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  console.log("runtime_connection tests (concern 068 — C4):");
  await testDiscoveryBranches();
  await testWatcher();
  await testCallRuntimePaths();
  await testClearRuntime();
  await testWaitForRuntimeConnection();
  console.log("All runtime_connection tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
