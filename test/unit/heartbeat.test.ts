/**
 * Unit tests for heartbeat.ts — the generic liveness primitive carved out of
 * bridge.ts's inline frozen-game detector (concern 068, C3 — the one
 * non-verbatim move on the decompose ladder). Pure: no bridge state, no
 * WebSocket, no registry — a controllable `ping` (resolve/reject on demand), an
 * `isAlive` flag, and an `onDead` spy drive the timer policy under fake timers.
 *
 * Each assertion is a genuinely derived outcome (ping-call counts, onDead-call
 * counts, the live timer count) — never a fn===fn tautology. They de-risk the
 * re-parameterized interval body so the C3 equivalence refuter
 * (`createHeartbeat({…}) ≡` the inline loop, design 068 §3 Module D) holds:
 *   1. fires `ping` every `intervalMs`
 *   2. counts CONSECUTIVE failures → `onDead` once at `maxFailures`; a success
 *      in between resets the counter (no premature fire)
 *   3. `stop()` clears the interval (no further pings)
 *   4. `start()` is single-flight (two starts → one interval)
 *   5. `isAlive()===false` self-stops: skips ping, does NOT count a failure,
 *      clears the interval (the load-bearing `!runtimeChannel` guard)
 *   6. `start()` invokes `.unref()` on the created handle
 */

import assert from "node:assert/strict";
import FakeTimers from "@sinonjs/fake-timers";
import { createHeartbeat } from "../../src/heartbeat.js";

// ── 1. fires ping every intervalMs ────────────────────────────────────

async function testFiresEveryInterval() {
  const clock = FakeTimers.install({ toFake: ["setInterval", "clearInterval"] });
  let pingCalls = 0;
  try {
    const hb = createHeartbeat({
      ping: () => {
        pingCalls++;
        return Promise.resolve("ok");
      },
      isAlive: () => true,
      onDead: () => {},
      intervalMs: 1000,
      maxFailures: 4,
    });
    hb.start();
    assert.equal(pingCalls, 0, "no ping before the first interval elapses");
    await clock.tickAsync(1000);
    assert.equal(pingCalls, 1, "ping fired once after one interval");
    await clock.tickAsync(1000);
    assert.equal(pingCalls, 2, "ping fired again after the next interval");
    hb.stop();
    console.log("  PASS: fires ping every intervalMs");
  } finally {
    clock.uninstall();
  }
}

// ── 2. consecutive-failure counting → onDead once at maxFailures (reset) ─

async function testFailureThresholdWithReset() {
  const clock = FakeTimers.install({ toFake: ["setInterval", "clearInterval"] });
  let pingCalls = 0;
  let onDeadCalls = 0;
  let mode: "resolve" | "reject" = "reject";
  try {
    const hb = createHeartbeat({
      ping: () => {
        pingCalls++;
        return mode === "reject" ? Promise.reject(new Error("probe failed")) : Promise.resolve("ok");
      },
      isAlive: () => true,
      onDead: () => {
        onDeadCalls++;
      },
      intervalMs: 1000,
      maxFailures: 3,
    });
    hb.start();
    await clock.tickAsync(1000); // fail 1 → failures = 1
    await clock.tickAsync(1000); // fail 2 → failures = 2
    assert.equal(onDeadCalls, 0, "no onDead before maxFailures CONSECUTIVE fails");

    mode = "resolve";
    await clock.tickAsync(1000); // success → failures reset to 0
    mode = "reject";
    await clock.tickAsync(1000); // fail 1 (post-reset)
    await clock.tickAsync(1000); // fail 2
    assert.equal(onDeadCalls, 0, "the intervening success reset the consecutive-failure counter");

    await clock.tickAsync(1000); // fail 3 → onDead + internal stop()
    assert.equal(onDeadCalls, 1, "onDead fires exactly once, on the maxFailures-th consecutive failure");

    const pingsAtDeath = pingCalls;
    await clock.tickAsync(5000); // interval cleared by stop() → nothing more runs
    assert.equal(pingCalls, pingsAtDeath, "stop() (via onDead) halts further pings");
    assert.equal(onDeadCalls, 1, "onDead does not fire again after teardown");
    console.log("  PASS: consecutive-failure counting; a success resets; onDead once at maxFailures");
  } finally {
    clock.uninstall();
  }
}

// ── 3. stop() clears the interval ─────────────────────────────────────

async function testStopClears() {
  const clock = FakeTimers.install({ toFake: ["setInterval", "clearInterval"] });
  let pingCalls = 0;
  try {
    const hb = createHeartbeat({
      ping: () => {
        pingCalls++;
        return Promise.resolve();
      },
      isAlive: () => true,
      onDead: () => {},
      intervalMs: 1000,
      maxFailures: 4,
    });
    hb.start();
    await clock.tickAsync(1000);
    assert.equal(pingCalls, 1, "one ping before stop");
    hb.stop();
    assert.equal(clock.countTimers(), 0, "stop() cleared the interval");
    await clock.tickAsync(10000);
    assert.equal(pingCalls, 1, "no further pings after stop()");
    console.log("  PASS: stop() clears the interval");
  } finally {
    clock.uninstall();
  }
}

// ── 4. start() single-flight (two starts → one interval) ──────────────

async function testStartSingleFlight() {
  const clock = FakeTimers.install({ toFake: ["setInterval", "clearInterval"] });
  let pingCalls = 0;
  try {
    const hb = createHeartbeat({
      ping: () => {
        pingCalls++;
        return Promise.resolve();
      },
      isAlive: () => true,
      onDead: () => {},
      intervalMs: 1000,
      maxFailures: 4,
    });
    hb.start();
    hb.start(); // second start must be a no-op (single-flight)
    assert.equal(clock.countTimers(), 1, "two start()s create only ONE interval");
    await clock.tickAsync(1000);
    assert.equal(pingCalls, 1, "single interval → ping fires once per tick, not twice");
    hb.stop();
    console.log("  PASS: start() is single-flight (one interval)");
  } finally {
    clock.uninstall();
  }
}

// ── 5. isAlive()===false self-stops (no ping, no failure, interval cleared) ─

async function testIsAliveSelfStop() {
  const clock = FakeTimers.install({ toFake: ["setInterval", "clearInterval"] });
  let pingCalls = 0;
  let onDeadCalls = 0;
  try {
    const hb = createHeartbeat({
      ping: () => {
        pingCalls++;
        return Promise.reject(new Error("ping must not run when isAlive() is false"));
      },
      isAlive: () => false,
      onDead: () => {
        onDeadCalls++;
      },
      intervalMs: 1000,
      // Lowest possible threshold: if the self-stop wrongly counted as a
      // failure (the folded-null-check trap the design forbids), onDead would
      // fire on this very tick. It must NOT.
      maxFailures: 1,
    });
    hb.start();
    assert.equal(clock.countTimers(), 1, "interval armed");
    await clock.tickAsync(1000);
    assert.equal(pingCalls, 0, "isAlive()=false skips ping entirely");
    assert.equal(onDeadCalls, 0, "self-stop is NOT a failure — onDead does not fire even at maxFailures=1");
    assert.equal(clock.countTimers(), 0, "the tick self-stopped the interval (maps the inline !runtimeChannel guard)");
    await clock.tickAsync(10000);
    assert.equal(pingCalls, 0, "stays stopped — no pings after self-stop");
    console.log("  PASS: isAlive=false self-stops (no ping, no failure increment, interval cleared)");
  } finally {
    clock.uninstall();
  }
}

// ── 6. start() invokes unref() on the created handle ──────────────────

async function testUnrefInvoked() {
  // Real timers + a manual setInterval stub so the created handle is captured
  // directly (and its unref spied) — the loop body never needs to fire.
  let unrefCalled = false;
  const realSetInterval = globalThis.setInterval;
  const realClearInterval = globalThis.clearInterval;

  const fakeHandle = {
    unref(): NodeJS.Timeout {
      unrefCalled = true;
      return fakeHandle;
    },
  } as unknown as NodeJS.Timeout;

  globalThis.setInterval = (() => fakeHandle) as unknown as typeof globalThis.setInterval;
  globalThis.clearInterval = (() => undefined) as unknown as typeof globalThis.clearInterval;

  try {
    const hb = createHeartbeat({
      ping: () => Promise.resolve(),
      isAlive: () => true,
      onDead: () => {},
      intervalMs: 1000,
      maxFailures: 4,
    });
    hb.start();
    assert.ok(unrefCalled, "start() invokes unref() on the created interval handle");
    hb.stop();
    console.log("  PASS: start() invokes unref() on the created handle");
  } finally {
    globalThis.setInterval = realSetInterval;
    globalThis.clearInterval = realClearInterval;
  }
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  console.log("heartbeat tests (concern 068 — C3):");
  await testFiresEveryInterval();
  await testFailureThresholdWithReset();
  await testStopClears();
  await testStartSingleFlight();
  await testIsAliveSelfStop();
  await testUnrefInvoked();
  console.log("All 6 heartbeat tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
