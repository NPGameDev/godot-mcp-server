/**
 * Unit tests for runtime_connection.ts — the playtest runtime-connection
 * aggregate carved out of bridge.ts (the integrator: combines channel, heartbeat, and registry).
 *
 * Drives the aggregate through its injected `deps` seam (mirrors
 * extensionRegistrar.test.ts's fake-injection idiom): a fake createChannel
 * returning a controllable channel (call resolves/rejects on command, close is
 * a spy), a fake createHeartbeat returning start/stop spies, and a fake registry
 * whose reader fns return scripted values (with watchRegistry capturing the
 * onDiscovered/onRemoved callbacks so a test can drive discovery). No real
 * WebSocket, no real registry file — every assertion is a genuinely derived
 * outcome (channel URLs, call/close counts, heartbeat start/stop counts,
 * resolved values, mapped error codes), never a fn===fn tautology.
 *
 * Groups:
 *   1. discovery branches — explicit-port static channel; no-port/no-projectPath → GAME_NOT_RUNNING
 *   2. the watcher — onDiscovered swap/port/heartbeat.start/waiter-resolve; onRemoved heartbeat.stop/close/undefined
 *   2c. a rediscovery — the same port keeps the open channel; a new port replaces it
 *   3. callRuntime paths — fast / normal / explicit + the CONNECT_FAILED/DISCONNECTED → GAME_NOT_RUNNING mapping
 *   4. clearRuntime — heartbeat.stop + close + undefined both
 *   4b. explicit-port re-creation — after clearRuntime nulls the pinned channel, the next callRuntime rebuilds it instead of dereferencing undefined
 *   5. waitForRuntimeConnection timeout — no-projectPath → undefined; deadline+no-discovery → undefined after the timer
 *   5b. explicit-port wait — the pinned runtime is probed through any failure until it answers (its port), the deadline passes or close() runs (undefined)
 *   5c. discovery wait — the registry is re-checked while the wait is pending, and only then
 */

import assert from "node:assert/strict";
import FakeTimers from "@sinonjs/fake-timers";
import { createRuntimeConnection, type RuntimeConnectionDeps } from "../../src/transport/runtimeConnection.js";
import { BridgeError } from "../../src/shared/errors.js";
import type { Channel } from "../../src/transport/channel.js";
import { captureStderr } from "./helpers.js";

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
    // One registry re-check; it reports through the watcher callbacks, as the real one does.
    recheck: (() => {}) as () => void,
    recheckCalls: 0,
  };
  // Typed through a variable rather than an annotated literal, so the fake fits
  // the seam whether or not the seam asks for recheckRegistry.
  const registryFns = {
    discoverRuntime: (projectPath: string) => reg.discover(projectPath),
    normalizePath: (p: string) => p,
    watchRegistry: (cbs: WatcherCbs) => {
      watcher = cbs;
    },
    unwatchRegistry: () => {
      reg.unwatchCalls++;
    },
    isWatcherActive: () => reg.watcherActive,
    getCachedRuntimePort: (projectPath: string) => reg.cached(projectPath),
    recheckRegistry: () => {
      reg.recheckCalls++;
      reg.recheck();
    },
  };
  const registry: RuntimeConnectionDeps["registry"] = registryFns;

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
  console.log("  PASS: watcher onDiscovered swap/port/heartbeat-start/waiter-resolve; onRemoved stop/close/undefined");
}

// ── 2b. onRemoved is idempotent ───────────────────────────────────────
//
// The watcher can report `removed` for an entry whose `discovered` it never
// reported (its pid was dead), so onRemoved must tolerate having nothing to close.

function testRemovedWithoutChannel() {
  const t = makeDeps();
  createRuntimeConnection({ projectPath: "/proj" }, t.deps);

  assert.doesNotThrow(() => t.fireRemoved("/proj"), "onRemoved with no channel open does not throw");
  assert.equal(t.hb.startCalls, 0, "onRemoved with no channel never starts the heartbeat");
  assert.equal(t.hb.stopCalls, 1, "onRemoved with no channel leaves the heartbeat stopped");
  assert.equal(t.channels.length, 0, "onRemoved with no channel opens none");

  // A repeat after a real teardown closes the channel once, not twice.
  t.fireDiscovered("/proj", 7000);
  t.fireRemoved("/proj");
  t.fireRemoved("/proj");
  assert.equal(t.channels[0].closeCalls, 1, "a repeated onRemoved does not close the channel again");
  console.log("  PASS: onRemoved with no channel open is harmless, and a repeat closes nothing twice");
}

// ── 2c. a rediscovery while a channel is open ─────────────────────────
//
// callRuntime can open the channel before the watcher reports the game, so the
// report that follows names the port already open, with a call in flight on it.

async function testSamePortRediscovery() {
  const t = makeDeps();
  const rc = createRuntimeConnection({ projectPath: "/proj" }, t.deps);
  t.reg.watcherActive = false;
  t.reg.discover = () => 7100;
  let answer: (value: unknown) => void = () => {};
  t.setCallImpl(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  );

  const waiterP = rc.waitForRuntimeConnection(60_000);
  const callP = rc.callRuntime("a");
  t.fireDiscovered("/proj", 7100);

  assert.equal(t.channels.length, 1, "a rediscovery of the open channel's port opens no second channel");
  assert.equal(t.channels[0].closeCalls, 0, "a rediscovery of the open channel's port does not close it");
  assert.equal(t.hb.startCalls, 1, "a rediscovery of the open channel's port starts the heartbeat");
  assert.deepEqual(await waiterP, { port: 7100 }, "a rediscovery of the open channel's port resolves the waiter");
  answer({ pong: 1 });
  assert.deepEqual(await callP, { pong: 1 }, "the call in flight resolves on the kept channel");
  console.log("  PASS: a rediscovery of the open channel's port keeps the channel and its call in flight");
}

function testNewPortRediscovery() {
  const t = makeDeps();
  createRuntimeConnection({ projectPath: "/proj" }, t.deps);
  t.fireDiscovered("/proj", 7100);
  t.fireDiscovered("/proj", 7200);

  assert.equal(t.channels[0].closeCalls, 1, "a rediscovery on a new port closes the old channel");
  assert.equal(t.channels.length, 2, "a rediscovery on a new port opens a new channel");
  assert.equal(t.channels[1].url, "ws://127.0.0.1:7200", "the new channel targets the new port");
  console.log("  PASS: a rediscovery on a new port replaces the channel");
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

  // Both cleared → the next call falls back to the fast path (which now finds nothing).
  t.reg.discover = () => null;
  await assert.rejects(
    () => rc.callRuntime("again"),
    isGameNotRunning,
    "after clearRuntime, callRuntime restarts discovery",
  );
  console.log("  PASS: clearRuntime stops the heartbeat, closes + clears the channel");
}

// ── 4b. explicit-port channel re-creation after clearRuntime ──────────

async function testExplicitPortRecreateAfterClear() {
  const t = makeDeps();
  const rc = createRuntimeConnection({ explicitRuntimePort: "9500" }, t.deps);
  assert.equal(t.channels.length, 1, "precondition: the pinned channel is built at construct");

  t.setCallImpl(() => Promise.resolve({ pong: true }));
  await rc.callRuntime("ping");
  assert.equal(t.channels[0].callLog.length, 1, "the first call routed to the pinned channel");

  // game_stopped notification (game stop/crash) nulls the pinned channel.
  rc.clearRuntime();
  assert.equal(t.channels[0].closeCalls, 1, "clearRuntime closed the pinned channel");

  // The next call must lazily re-create the channel against the pinned port,
  // not dereference the nulled one (the undefined.call crash this test guards).
  const r = await rc.callRuntime("ping");
  assert.deepEqual(r, { pong: true }, "callRuntime after clearRuntime re-creates and routes, not throws");
  assert.equal(t.channels.length, 2, "a fresh pinned channel was created for the post-clear call");
  assert.equal(t.channels[1].url, "ws://127.0.0.1:9500", "the re-created channel targets the same pinned port");
  assert.equal(t.channels[1].callLog.length, 1, "the post-clear call routed to the re-created channel");

  // The game_stop → runtime-cycle behavior end-to-end (editor emits game_stopped,
  // then a runtime tool re-cycles cleanly) needs a live editor and is covered by
  // the cross-version behavioral CI tier, not this pure unit.
  console.log("  PASS: explicit-port channel re-creates after clearRuntime (no undefined.call crash)");
}

// ── 5. waitForRuntimeConnection timeout ───────────────────────────────

async function testWaitForRuntimeConnection() {
  // No projectPath → immediate undefined.
  {
    const t = makeDeps();
    const rc = createRuntimeConnection({}, t.deps);
    assert.equal(await rc.waitForRuntimeConnection(5000), undefined, "no projectPath → immediate undefined");
  }

  // Deadline elapses with no discovery → resolves undefined after the timer.
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
      assert.equal(value, undefined, "the timeout resolves undefined");
    } finally {
      clock.uninstall();
    }
  }
  console.log("  PASS: waitForRuntimeConnection (no-projectPath → undefined; deadline+no-discovery → undefined)");
}

// ── 5b. waitForRuntimeConnection with an explicit runtime port ────────
//
// A pinned port runs no registry watcher, so no discovery ever arrives: the
// wait has to learn from the pinned runtime itself that it is up.

async function testExplicitPortWait() {
  const PROBE_CLOCK: FakeTimers.FakeTimerInstallOpts = {
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  };

  // The pinned runtime answers at once: the wait resolves with its port long before the deadline.
  {
    // Well inside game_start's 10 s wait, so a wait that only ends at the deadline fails.
    const ANSWERED_WITHIN_MS = 1000;
    const clock = FakeTimers.install(PROBE_CLOCK);
    try {
      const t = makeDeps();
      const rc = createRuntimeConnection({ projectPath: "/proj", explicitRuntimePort: "6636" }, t.deps);
      t.setCallImpl(() => Promise.resolve({ pong: true }));

      let settled: unknown = "still pending";
      void rc.waitForRuntimeConnection(10_000).then((v) => {
        settled = v;
      });
      await clock.tickAsync(ANSWERED_WITHIN_MS);
      assert.deepEqual(
        settled,
        { port: 6636 },
        "an explicit-port wait resolves with the pinned port once the runtime answers, not at the deadline",
      );
    } finally {
      clock.uninstall();
    }
  }

  // Four probe intervals: a probe still scheduled after the wait ends would run within it.
  const AFTER_WAIT_WINDOW_MS = 1000;

  // Nothing ever listens on the pinned port: the wait ends undefined at the deadline and logs why.
  {
    const clock = FakeTimers.install(PROBE_CLOCK);
    const cap = captureStderr();
    try {
      const t = makeDeps();
      const rc = createRuntimeConnection({ explicitRuntimePort: "6636" }, t.deps);
      t.setCallImpl(() => Promise.reject(new BridgeError("CONNECT_FAILED", "connection refused")));

      let settled: unknown = "still pending";
      void rc.waitForRuntimeConnection(5000).then((v) => {
        settled = v;
      });
      await clock.tickAsync(4999);
      assert.equal(settled, "still pending", "a pinned port nobody answers keeps the wait open until the deadline");
      await clock.tickAsync(1);
      assert.equal(settled, undefined, "a pinned port nobody answers resolves the wait undefined at the deadline");
      assert.ok(
        cap
          .output()
          .includes("[bridge] runtime on pinned port 6636 did not answer: no runtime server on 127.0.0.1:6636"),
        "the deadline logs the last probe's error to stderr",
      );
    } finally {
      cap.restore();
      clock.uninstall();
    }
  }

  // Nothing ever listens on the pinned port: probes run every 250 ms and stop with the wait.
  {
    const clock = FakeTimers.install(PROBE_CLOCK);
    const cap = captureStderr();
    try {
      const t = makeDeps();
      const rc = createRuntimeConnection({ explicitRuntimePort: "6636" }, t.deps);
      t.setCallImpl(() => Promise.reject(new BridgeError("CONNECT_FAILED", "connection refused")));

      void rc.waitForRuntimeConnection(5000);
      await clock.tickAsync(5000);
      assert.equal(t.channels[0].callLog.length, 20, "the pinned port was probed every 250 ms before the deadline");
      assert.equal(clock.countTimers(), 0, "no probe or deadline timer is left once the wait ends");
      await clock.tickAsync(AFTER_WAIT_WINDOW_MS);
      assert.equal(t.channels[0].callLog.length, 20, "no probe runs after the deadline");
    } finally {
      cap.restore();
      clock.uninstall();
    }
  }

  // A starting game can fail a probe with an auth timeout or a closed channel: the wait retries both.
  {
    const clock = FakeTimers.install(PROBE_CLOCK);
    try {
      const t = makeDeps();
      const rc = createRuntimeConnection({ projectPath: "/proj", explicitRuntimePort: "6636" }, t.deps);
      const failures = [
        new BridgeError("AUTH_FAILED", "auth handshake timed out"),
        new BridgeError("CLOSED", "channel closed by caller"),
      ];
      t.setCallImpl(() => {
        const failure = failures.shift();
        return failure ? Promise.reject(failure) : Promise.resolve({ pong: true });
      });

      let settled: unknown = "still pending";
      void rc.waitForRuntimeConnection(10_000).then((v) => {
        settled = v;
      });
      await clock.tickAsync(499);
      assert.equal(settled, "still pending", "an auth timeout or a closed channel keeps the pinned wait open");
      await clock.tickAsync(1);
      assert.deepEqual(settled, { port: 6636 }, "the third probe, the first answered, resolves the pinned port");
      assert.equal(t.channels[0].callLog.length, 3, "probing stops at the first answer");
    } finally {
      clock.uninstall();
    }
  }

  // close() ends a pinned wait: it resolves undefined and the probing stops.
  {
    const clock = FakeTimers.install(PROBE_CLOCK);
    try {
      const t = makeDeps();
      const rc = createRuntimeConnection({ explicitRuntimePort: "6636" }, t.deps);
      t.setCallImpl(() => Promise.reject(new BridgeError("CONNECT_FAILED", "connection refused")));

      let settled: unknown = "still pending";
      void rc.waitForRuntimeConnection(10_000).then((v) => {
        settled = v;
      });
      await clock.tickAsync(600);
      await rc.close();
      await clock.tickAsync(0);
      assert.equal(settled, undefined, "close() resolves a pending pinned wait undefined");
      assert.equal(clock.countTimers(), 0, "no probe or deadline timer is left once close() ends the wait");
      await clock.tickAsync(AFTER_WAIT_WINDOW_MS);
      assert.equal(t.channels[0].callLog.length, 3, "no probe runs after close()");
    } finally {
      clock.uninstall();
    }
  }

  // The game starts listening after a few refused probes: the wait resolves on the first answer.
  {
    const clock = FakeTimers.install(PROBE_CLOCK);
    try {
      const t = makeDeps();
      const rc = createRuntimeConnection({ projectPath: "/proj", explicitRuntimePort: "6636" }, t.deps);
      const failures = [
        new BridgeError("CONNECT_FAILED", "connection refused"),
        new BridgeError("CONNECT_FAILED", "connection refused"),
        new BridgeError("DISCONNECTED", "socket dropped"),
      ];
      t.setCallImpl(() => {
        const failure = failures.shift();
        return failure ? Promise.reject(failure) : Promise.resolve({ pong: true });
      });

      let settled: unknown = "still pending";
      void rc.waitForRuntimeConnection(10_000).then((v) => {
        settled = v;
      });
      await clock.tickAsync(749);
      assert.equal(settled, "still pending", "the wait stays open while the pinned port refuses the probes");
      await clock.tickAsync(1);
      assert.deepEqual(settled, { port: 6636 }, "the fourth probe, the first answered, resolves the pinned port");
      assert.equal(t.channels[0].callLog.length, 4, "probing stops at the first answer");
      assert.equal(clock.countTimers(), 0, "no probe or deadline timer is left once the runtime answers");
    } finally {
      clock.uninstall();
    }
  }
  console.log(
    "  PASS: waitForRuntimeConnection with an explicit port resolves once the pinned runtime answers, " +
      "retrying any failed probe until the deadline or close()",
  );
}

// ── 5c. the registry re-check during a discovery wait ─────────────────
//
// The registry watcher can miss a replacement of the file, so a discovery wait
// re-checks the registry itself until the wait ends.

async function testDiscoveryWaitRecheck() {
  const RECHECK_CLOCK: Parameters<typeof FakeTimers.install>[0] = {
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  };
  // Two re-check intervals of 250 ms.
  const RECHECKED_WITHIN_MS = 500;
  // Four re-check intervals: a re-check still scheduled after the wait ends would run within it.
  const AFTER_WAIT_WINDOW_MS = 1000;

  // The watch reports nothing; the second re-check finds the port: the wait resolves with it.
  {
    const clock = FakeTimers.install(RECHECK_CLOCK);
    try {
      const t = makeDeps();
      const rc = createRuntimeConnection({ projectPath: "/proj" }, t.deps);
      t.reg.recheck = () => {
        if (t.reg.recheckCalls === 2) t.fireDiscovered("/proj", 7100);
      };

      let settled: unknown = "still pending";
      void rc.waitForRuntimeConnection(10_000).then((v) => {
        settled = v;
      });
      await clock.tickAsync(RECHECKED_WITHIN_MS);
      assert.deepEqual(
        settled,
        { port: 7100 },
        "a discovery wait resolves with the port the registry re-check finds when the watch reports nothing",
      );
      const calls = t.reg.recheckCalls;
      await clock.tickAsync(AFTER_WAIT_WINDOW_MS);
      assert.equal(t.reg.recheckCalls, calls, "no registry re-check runs after the wait resolves");
    } finally {
      clock.uninstall();
    }
  }

  // The registry never has the port: the wait re-checks until its deadline, then stops.
  {
    const clock = FakeTimers.install(RECHECK_CLOCK);
    try {
      const t = makeDeps();
      const rc = createRuntimeConnection({ projectPath: "/proj" }, t.deps);

      let settled: unknown = "still pending";
      void rc.waitForRuntimeConnection(1000).then((v) => {
        settled = v;
      });
      await clock.tickAsync(1000);
      assert.equal(
        settled,
        undefined,
        "a discovery wait the registry never answers resolves undefined at the deadline",
      );
      assert.ok(t.reg.recheckCalls > 0, "the registry is re-checked while a discovery wait is pending");
      const calls = t.reg.recheckCalls;
      await clock.tickAsync(AFTER_WAIT_WINDOW_MS);
      assert.equal(t.reg.recheckCalls, calls, "no registry re-check runs after the wait times out");
    } finally {
      clock.uninstall();
    }
  }

  // close() ends a discovery wait: it resolves undefined and the re-checks stop.
  {
    const clock = FakeTimers.install(RECHECK_CLOCK);
    try {
      const t = makeDeps();
      const rc = createRuntimeConnection({ projectPath: "/proj" }, t.deps);

      let settled: unknown = "still pending";
      void rc.waitForRuntimeConnection(10_000).then((v) => {
        settled = v;
      });
      await clock.tickAsync(600);
      await rc.close();
      await clock.tickAsync(0);
      assert.equal(settled, undefined, "close() resolves a pending discovery wait undefined");
      const calls = t.reg.recheckCalls;
      await clock.tickAsync(AFTER_WAIT_WINDOW_MS);
      assert.equal(t.reg.recheckCalls, calls, "no registry re-check runs after close()");
    } finally {
      clock.uninstall();
    }
  }

  // A pinned wait asks the pinned runtime, never the registry.
  {
    const clock = FakeTimers.install(RECHECK_CLOCK);
    const cap = captureStderr();
    try {
      const t = makeDeps();
      const rc = createRuntimeConnection({ projectPath: "/proj", explicitRuntimePort: "6636" }, t.deps);
      t.setCallImpl(() => Promise.reject(new BridgeError("CONNECT_FAILED", "connection refused")));

      void rc.waitForRuntimeConnection(5000);
      await clock.tickAsync(5000);
      assert.equal(t.reg.recheckCalls, 0, "a pinned wait never re-checks the registry");
    } finally {
      cap.restore();
      clock.uninstall();
    }
  }
  console.log(
    "  PASS: a discovery wait re-checks the registry until it resolves, times out or close() runs; a pinned wait never does",
  );
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  console.log("runtime_connection tests:");
  await testDiscoveryBranches();
  await testWatcher();
  testRemovedWithoutChannel();
  await testSamePortRediscovery();
  testNewPortRediscovery();
  await testCallRuntimePaths();
  await testClearRuntime();
  await testExplicitPortRecreateAfterClear();
  await testWaitForRuntimeConnection();
  await testExplicitPortWait();
  await testDiscoveryWaitRecheck();
  console.log("All runtime_connection tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
