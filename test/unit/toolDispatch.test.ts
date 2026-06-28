/**
 * Unit tests for toolDispatch.ts — callAndWrap, which dispatches a bridge call
 * and shapes the result into a tool response (success pass-through,
 * payload/exception error mapping, hint injection, and runtime routing).
 */

import assert from "node:assert/strict";
import { callAndWrap } from "../../src/registration/toolDispatch.js";
import { BridgeError } from "../../src/shared/errors.js";
import type { Bridge } from "../../src/shared/types.js";

// Mirrors the makeBridge fake in errorContract.test.ts
// A method-aware fake bridge: each branch overrides only the call(s) it needs;
// the rest default to a benign success so an unexpected call never crashes.
function makeBridge(
  over: {
    call?: (m: string, p?: unknown) => Promise<unknown>;
    callRuntime?: (m: string, p?: unknown) => Promise<unknown>;
  } = {},
): Bridge {
  return {
    call: over.call ?? (async () => ({ success: true })),
    callRuntime: over.callRuntime ?? (async () => ({ success: true })),
    close: async () => {},
    getGodotVersionString: () => null,
    getGodotVersion: () => null,
  } as unknown as Bridge;
}

// ── callAndWrap ──────────────────────────────────────────────────────

// Happy path: success payload is JSON-stringified, not an error.
{
  const bridge = makeBridge({ call: async () => ({ success: true, value: 7 }) });
  const result = await callAndWrap(bridge, "some.method", {});
  assert.equal(result.isError, undefined);
  assert.equal(JSON.parse(result.content[0].text).value, 7);
}

// Payload error: {success:false} becomes a toolError with the same code.
{
  const bridge = makeBridge({ call: async () => ({ success: false, code: "NOT_FOUND", error: "nope" }) });
  const result = await callAndWrap(bridge, "some.method", {});
  assert.equal(result.isError, true);
  assert.equal(JSON.parse(result.content[0].text).code, "NOT_FOUND");
}

// Thrown BridgeError (non-runtime): code preserved + default exception hint.
{
  const bridge = makeBridge({
    call: async () => {
      throw new BridgeError("TIMEOUT", "slow");
    },
  });
  const result = await callAndWrap(bridge, "some.method", {});
  assert.equal(result.isError, true);
  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.code, "TIMEOUT");
  assert.ok(payload.hint);
}

// extensionTimeoutHint overrides the default TIMEOUT hint.
{
  const bridge = makeBridge({
    call: async () => {
      throw new BridgeError("TIMEOUT", "slow");
    },
  });
  const result = await callAndWrap(bridge, "some.method", {}, { extensionTimeoutHint: "ext-specific" });
  assert.equal(JSON.parse(result.content[0].text).hint, "ext-specific");
}

// successHint injected when absent; not overwritten when the toolkit set one.
{
  const bare = makeBridge({ call: async () => ({ success: true }) });
  const injected = await callAndWrap(bare, "some.method", {}, { successHint: "next" });
  assert.equal(JSON.parse(injected.content[0].text).hint, "next");

  const withHint = makeBridge({ call: async () => ({ success: true, hint: "toolkit" }) });
  const kept = await callAndWrap(withHint, "some.method", {}, { successHint: "mine" });
  assert.equal(JSON.parse(kept.content[0].text).hint, "toolkit");
}

// runtime:true routes through callRuntime (call must not be invoked).
{
  const bridge = makeBridge({
    call: async () => {
      throw new Error("call should not run for runtime requests");
    },
    callRuntime: async () => ({ success: true, v: 1 }),
  });
  const result = await callAndWrap(bridge, "some.method", {}, { runtime: true });
  assert.equal(result.isError, undefined);
  assert.equal(JSON.parse(result.content[0].text).v, 1);
}
