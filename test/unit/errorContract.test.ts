/**
 * Unit tests for errorContract.ts — the error-shaping utilities: the toolError
 * family (toolError / toolErrorFromPayload / toolErrorFromException) and
 * runtimeErrorWithCrashContext.
 */
import assert from "node:assert/strict";
import {
  toolError,
  toolErrorFromPayload,
  toolErrorFromException,
  runtimeErrorWithCrashContext,
} from "../../src/shared/errorContract.js";
import { BridgeError } from "../../src/shared/errors.js";
import type { Bridge } from "../../src/shared/types.js";

// ── toolError ────────────────────────────────────────────────────────

// Basic error response
{
  const result = toolError("NOT_FOUND", "Node not found");
  assert.equal(result.isError, true);
  assert.equal(result.content.length, 1);
  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.success, false);
  assert.equal(payload.code, "NOT_FOUND");
  assert.equal(payload.error, "Node not found");
  assert.equal(payload.hint, undefined);
}

// Error with hint
{
  const result = toolError("TIMEOUT", "timed out", "Try again");
  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.hint, "Try again");
}

// String code (non-ErrorCode union)
{
  const result = toolError("CUSTOM_CODE", "custom error");
  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.code, "CUSTOM_CODE");
}

// ── toolErrorFromPayload ─────────────────────────────────────────────

// success: false → error response
{
  const result = toolErrorFromPayload({ success: false, error: "bad", code: "INVALID_PARAMS" });
  assert.ok(result != null);
  assert.equal(result!.isError, true);
  const payload = JSON.parse(result!.content[0].text);
  assert.equal(payload.code, "INVALID_PARAMS");
  assert.equal(payload.error, "bad");
}

// success: false with hint
{
  const result = toolErrorFromPayload({ success: false, error: "bad", code: "X", hint: "try this" });
  assert.ok(result != null);
  const payload = JSON.parse(result!.content[0].text);
  assert.equal(payload.hint, "try this");
}

// success: true → undefined (pass-through)
{
  const result = toolErrorFromPayload({ success: true, data: "ok" });
  assert.equal(result, undefined);
}

// success absent → undefined (pass-through for normal results)
{
  const result = toolErrorFromPayload({ data: "ok" });
  assert.equal(result, undefined);
}

// null / non-object → undefined
assert.equal(toolErrorFromPayload(null), undefined);
assert.equal(toolErrorFromPayload(undefined), undefined);
assert.equal(toolErrorFromPayload("string"), undefined);
assert.equal(toolErrorFromPayload(42), undefined);

// Missing code defaults to "INTERNAL"
{
  const result = toolErrorFromPayload({ success: false, error: "oops" });
  assert.ok(result != null);
  const payload = JSON.parse(result!.content[0].text);
  assert.equal(payload.code, "INTERNAL");
}

// Missing error defaults to "unknown error"
{
  const result = toolErrorFromPayload({ success: false });
  assert.ok(result != null);
  const payload = JSON.parse(result!.content[0].text);
  assert.equal(payload.error, "unknown error");
}

// Non-string code/error types handled gracefully
{
  const result = toolErrorFromPayload({ success: false, code: 123, error: true });
  assert.ok(result != null);
  const payload = JSON.parse(result!.content[0].text);
  assert.equal(payload.code, "INTERNAL");
  assert.equal(payload.error, "unknown error");
}

// ── toolErrorFromException ───────────────────────────────────────────

// BridgeError preserves code
{
  const err = new BridgeError("TIMEOUT", "timed out after 5s");
  const result = toolErrorFromException(err);
  assert.equal(result.isError, true);
  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.code, "TIMEOUT");
  assert.ok(payload.hint); // TIMEOUT has a default hint
}

// BridgeError with known hint codes
{
  for (const code of ["TIMEOUT", "DISCONNECTED", "GAME_NOT_RUNNING"] as const) {
    const err = new BridgeError(code, `test ${code}`);
    const result = toolErrorFromException(err);
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.code, code);
    assert.ok(payload.hint, `Expected hint for ${code}`);
  }
}

// Regular Error → INTERNAL
{
  const err = new Error("something broke");
  const result = toolErrorFromException(err);
  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.code, "INTERNAL");
  assert.equal(payload.error, "something broke");
}

// Non-Error value → INTERNAL + string coercion
{
  const result = toolErrorFromException("raw string error");
  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.code, "INTERNAL");
}

// Mirrors the makeBridge fake in toolDispatch.test.ts
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

// ── runtimeErrorWithCrashContext ─────────────────────────────────────

// Crash code + debugger.get_log context → hint carries the formatted errors.
{
  const bridge = makeBridge({
    call: async () => ({
      error_buffer: [{ message: "boom", source: "res://x.gd", line: 5 }],
      lines: ["tail"],
    }),
  });
  const result = await runtimeErrorWithCrashContext(bridge, new BridgeError("TIMEOUT", "t"));
  assert.equal(result.isError, true);
  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.code, "TIMEOUT");
  assert.ok(payload.hint.includes("boom (res://x.gd:5)"));
  assert.ok(payload.hint.includes("tail"));
  assert.ok(payload.hint.includes("Recent errors from editor console"));
}

// debugger.get_log throws → falls back to editor.get_console for context.
{
  const bridge = makeBridge({
    call: async (m: string) => {
      if (m === "debugger.get_log") throw new BridgeError("DISCONNECTED", "no debugger");
      return { count: 2, entries: "console errs" };
    },
  });
  const result = await runtimeErrorWithCrashContext(bridge, new BridgeError("GAME_NOT_RUNNING", "g"));
  assert.equal(result.isError, true);
  assert.ok(JSON.parse(result.content[0].text).hint.includes("console errs"));
}

// No context from either source → generic toolErrorFromException (code kept).
{
  const bridge = makeBridge({
    call: async (m: string) => (m === "editor.get_console" ? { count: 0 } : {}),
  });
  const result = await runtimeErrorWithCrashContext(bridge, new BridgeError("COMPILATION_FAILED", "c"));
  assert.equal(JSON.parse(result.content[0].text).code, "COMPILATION_FAILED");
}

// Non-crash code → immediate toolErrorFromException, no crash fetch attempted.
{
  const bridge = makeBridge({
    call: async () => {
      throw new Error("crash fetch should not run");
    },
  });
  const result = await runtimeErrorWithCrashContext(bridge, new BridgeError("NOT_FOUND", "x"));
  assert.equal(JSON.parse(result.content[0].text).code, "NOT_FOUND");
}

// Plain Error → INTERNAL.
{
  const result = await runtimeErrorWithCrashContext(makeBridge(), new Error("boom"));
  assert.equal(JSON.parse(result.content[0].text).code, "INTERNAL");
}
