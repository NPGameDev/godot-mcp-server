/**
 * Unit tests for scripts/ci/editor-wait-scene.mjs, the cross-version composite's wait for an
 * edited scene before the smoke. Drives the reply classification, the bounded poll loop on a
 * fake clock and the verdict line the composite prints.
 */
import assert from "node:assert/strict";
import { sceneState, waitForScene, waitVerdict } from "../../scripts/ci/editor-wait-scene.mjs";

function bridgeError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

/** A clock that only moves when a call or a pause spends time on it. */
function fakeClock(callCostMs: number): {
  now: () => number;
  pause: (ms: number) => Promise<void>;
  spend: () => void;
} {
  let t = 1000;
  return {
    now: () => t,
    pause: async (ms: number) => {
      t += ms;
    },
    spend: () => {
      t += callCostMs;
    },
  };
}

{
  assert.equal(sceneState({ tree: "{}" }, undefined), "ready", "a reply with a tree string carries a scene");
}

{
  assert.equal(
    sceneState({ code: "NO_SCENE", error: "no edited scene" }, undefined),
    "NO_SCENE",
    "a NO_SCENE reply is not ready and names its code",
  );
}

{
  assert.equal(
    sceneState(undefined, bridgeError("CONNECT_FAILED", "refused")),
    "CONNECT_FAILED",
    "a failed call is not ready and names the bridge error code",
  );
}

{
  assert.equal(
    sceneState({ success: false }, undefined),
    "unexpected reply",
    "success false without a code is no scene",
  );
}

{
  assert.equal(sceneState({}, undefined), "unexpected reply", "a reply without a tree string is no scene");
}

{
  const clock = fakeClock(50);
  const replies = [{ code: "NO_SCENE" }, { code: "NO_SCENE" }, { tree: "{}" }];
  const result = await waitForScene(
    async () => {
      clock.spend();
      return replies.shift();
    },
    { timeoutMs: 60000, intervalMs: 250, now: clock.now, pause: clock.pause },
  );
  assert.deepEqual(
    result,
    { ready: true, waitedMs: 650, calls: 3, first: "NO_SCENE", last: "ready" },
    "two NO_SCENE replies then a scene: ready after three calls and two pauses",
  );
}

{
  const clock = fakeClock(50);
  const timeouts: number[] = [];
  const result = await waitForScene(
    async (callTimeoutMs: number) => {
      timeouts.push(callTimeoutMs);
      clock.spend();
      return { code: "NO_SCENE" };
    },
    { timeoutMs: 1000, intervalMs: 250, now: clock.now, pause: clock.pause },
  );
  assert.deepEqual(
    result,
    { ready: false, waitedMs: 1000, calls: 4, first: "NO_SCENE", last: "NO_SCENE" },
    "NO_SCENE until the bound: the wait stops at the bound, not past it",
  );
  assert.deepEqual(timeouts, [1000, 700, 400, 100], "no call is given more time than the bound has left");
}

{
  const clock = fakeClock(0);
  const result = await waitForScene(
    async () => {
      clock.spend();
      throw bridgeError("TIMEOUT", "no reply");
    },
    { timeoutMs: 500, intervalMs: 250, now: clock.now, pause: clock.pause },
  );
  assert.equal(result.ready, false, "a call that keeps failing never reads as ready");
  assert.equal(result.last, "TIMEOUT", "the last state names the failing call's code");
}

{
  assert.equal(
    waitVerdict({ ready: true, waitedMs: 4523, calls: 18, first: "NO_SCENE", last: "ready" }, 60000),
    "scene_wait=ready (edited scene after 4523 ms, 18 calls, first reply NO_SCENE)",
    "the ready verdict logs the wait in ms",
  );
}

{
  assert.equal(
    waitVerdict({ ready: false, waitedMs: 60000, calls: 1, first: "NO_SCENE", last: "NO_SCENE" }, 60000),
    "scene_wait=timeout (no edited scene after 60000 ms of 60000 ms, 1 call, last reply NO_SCENE)",
    "the timeout verdict names the bound and the last reply",
  );
}

console.log("All 10 tests passed.");
