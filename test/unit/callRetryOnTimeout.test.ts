import assert from "node:assert/strict";
import { callRetryOnTimeout } from "../helpers.js";
import type { BridgeInstance } from "../helpers.js";

// callRetryOnTimeout must retry ONLY a transport timeout (a thrown Error whose
// message contains "timed out"), so a cold first-playtest launch can't fail a
// smoke section, while a real tool error (a returned {success:false, code}
// envelope) or any other thrown error surfaces immediately, never masked.
//
// A minimal mock bridge plays a scripted sequence of `call` outcomes and counts
// invocations; the cast erases the unused method/params/timeout arguments.
function mockBridge(script: Array<() => Promise<unknown>>): {
  bridge: BridgeInstance;
  calls: () => number;
} {
  let i = 0;
  const bridge = {
    call: () => {
      const step = script[Math.min(i, script.length - 1)];
      i++;
      return step();
    },
  } as unknown as BridgeInstance;
  return { bridge, calls: () => i };
}

const timeout = () => Promise.reject(new Error("call to game.start timed out after 5000ms"));

// 1. Retries past transport timeouts, then returns the first real response.
{
  const ok = () => Promise.resolve({ success: false, code: "ALREADY_PLAYING" });
  const { bridge, calls } = mockBridge([timeout, timeout, ok]);
  const result = (await callRetryOnTimeout(bridge, "game.start", {}, 5000, 3, 1)) as { code?: string };
  assert.equal(result.code, "ALREADY_PLAYING");
  assert.equal(calls(), 3); // two timeouts retried, third returned
  console.log("  PASS: retries timeouts then returns the first response");
}

// 2. A coded error envelope (a real tool error) returns immediately — never retried.
{
  const codedError = () => Promise.resolve({ success: false, code: "PATH_DENIED" });
  const { bridge, calls } = mockBridge([codedError]);
  const result = (await callRetryOnTimeout(bridge, "game.start", { scene_path: "bogus" }, 5000, 3, 1)) as {
    code?: string;
  };
  assert.equal(result.code, "PATH_DENIED");
  assert.equal(calls(), 1); // no retry — error envelopes are real
  console.log("  PASS: coded error envelope returns on the first call (no retry)");
}

// 3. A non-timeout throw propagates immediately (not a cold-start symptom).
{
  const otherThrow = () => Promise.reject(new Error("WebSocket closed before response"));
  const { bridge, calls } = mockBridge([otherThrow]);
  await assert.rejects(() => callRetryOnTimeout(bridge, "game.start", {}, 5000, 3, 1), /WebSocket closed/);
  assert.equal(calls(), 1); // not a timeout → no retry
  console.log("  PASS: non-timeout throw propagates without retry");
}

// 4. Persistent timeouts re-throw the timeout once attempts are exhausted.
{
  const { bridge, calls } = mockBridge([timeout, timeout, timeout]);
  await assert.rejects(() => callRetryOnTimeout(bridge, "game.start", {}, 5000, 3, 1), /timed out/);
  assert.equal(calls(), 3); // attempts exhausted
  console.log("  PASS: persistent timeouts re-throw after exhausting attempts");
}

console.log("All callRetryOnTimeout tests passed.");
