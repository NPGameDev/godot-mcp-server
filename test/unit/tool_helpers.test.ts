/**
 * Unit tests for tool_helpers.ts — error utilities, schema conversion,
 * and coercion helpers.
 */
import assert from "node:assert/strict";
import {
  toolError,
  toolErrorFromPayload,
  toolErrorFromException,
  coercedBoolean,
  jsonCoerce,
  jsonSchemaToParamMap,
} from "../../src/tool_helpers.js";
import { BridgeError } from "../../src/errors.js";

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
  assert.ok(result !== null);
  assert.equal(result!.isError, true);
  const payload = JSON.parse(result!.content[0].text);
  assert.equal(payload.code, "INVALID_PARAMS");
  assert.equal(payload.error, "bad");
}

// success: false with hint
{
  const result = toolErrorFromPayload({ success: false, error: "bad", code: "X", hint: "try this" });
  assert.ok(result !== null);
  const payload = JSON.parse(result!.content[0].text);
  assert.equal(payload.hint, "try this");
}

// success: true → null (pass-through)
{
  const result = toolErrorFromPayload({ success: true, data: "ok" });
  assert.equal(result, null);
}

// success absent → null (pass-through for normal results)
{
  const result = toolErrorFromPayload({ data: "ok" });
  assert.equal(result, null);
}

// null / non-object → null
assert.equal(toolErrorFromPayload(null), null);
assert.equal(toolErrorFromPayload(undefined), null);
assert.equal(toolErrorFromPayload("string"), null);
assert.equal(toolErrorFromPayload(42), null);

// Missing code defaults to "INTERNAL"
{
  const result = toolErrorFromPayload({ success: false, error: "oops" });
  assert.ok(result !== null);
  const payload = JSON.parse(result!.content[0].text);
  assert.equal(payload.code, "INTERNAL");
}

// Missing error defaults to "unknown error"
{
  const result = toolErrorFromPayload({ success: false });
  assert.ok(result !== null);
  const payload = JSON.parse(result!.content[0].text);
  assert.equal(payload.error, "unknown error");
}

// Non-string code/error types handled gracefully
{
  const result = toolErrorFromPayload({ success: false, code: 123, error: true });
  assert.ok(result !== null);
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

// ── coercedBoolean ───────────────────────────────────────────────────

{
  const schema = coercedBoolean();
  // String "true" → true
  assert.equal(schema.parse("true"), true);
  assert.equal(schema.parse("True"), true);
  assert.equal(schema.parse("TRUE"), true);
  // String "1" → true
  assert.equal(schema.parse("1"), true);
  // String "false" → false
  assert.equal(schema.parse("false"), false);
  assert.equal(schema.parse("False"), false);
  // String "0" → false
  assert.equal(schema.parse("0"), false);
  // Native booleans pass through
  assert.equal(schema.parse(true), true);
  assert.equal(schema.parse(false), false);
}

// ── jsonCoerce ───────────────────────────────────────────────────────

// JSON array string → parsed array
assert.deepEqual(jsonCoerce('["a","b"]'), ["a", "b"]);
// JSON object string → parsed object
assert.deepEqual(jsonCoerce('{"key":"val"}'), { key: "val" });
// Non-JSON string → passthrough
assert.equal(jsonCoerce("hello"), "hello");
// Non-string → passthrough
assert.equal(jsonCoerce(42), 42);
assert.equal(jsonCoerce(null), null);
assert.equal(jsonCoerce(undefined), undefined);
assert.deepEqual(jsonCoerce([1, 2]), [1, 2]);

// ── jsonSchemaToParamMap ─────────────────────────────────────────────

// Basic type mapping
{
  const schema = {
    type: "object",
    properties: {
      name: { type: "string", description: "The name" },
      count: { type: "integer", description: "How many" },
      active: { type: "boolean" },
      items: { type: "array" },
      data: { type: "unknown_type" },
    },
    required: ["name", "count"],
  };
  const params = jsonSchemaToParamMap(schema);
  assert.deepEqual(params.name, { type: "string", required: true, description: "The name" });
  assert.deepEqual(params.count, { type: "number", required: true, description: "How many" });
  assert.deepEqual(params.active, { type: "boolean", required: false });
  assert.deepEqual(params.items, { type: "array", required: false });
  assert.deepEqual(params.data, { type: "string", required: false }); // default type
}

// Enum detection
{
  const schema = {
    properties: { mode: { type: "string", enum: ["fast", "slow"] } },
    required: ["mode"],
  };
  const params = jsonSchemaToParamMap(schema);
  assert.equal(params.mode.type, "enum");
  assert.equal(params.mode.required, true);
}

// Number type
{
  const schema = {
    properties: { val: { type: "number" } },
  };
  const params = jsonSchemaToParamMap(schema);
  assert.equal(params.val.type, "number");
}

// Empty properties → empty map
{
  const params = jsonSchemaToParamMap({ type: "object" });
  assert.deepEqual(params, {});
}

// Description is omitted when not a string
{
  const schema = {
    properties: { x: { type: "string", description: 42 } },
  };
  const params = jsonSchemaToParamMap(schema);
  assert.equal(params.x.description, undefined);
}

console.log("All tool_helpers tests passed.");
