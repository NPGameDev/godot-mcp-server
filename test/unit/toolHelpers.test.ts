/**
 * Unit tests for tool_helpers.ts — error utilities, schema conversion,
 * and coercion helpers.
 */

import assert from "node:assert/strict";
import { jsonSchemaToParamMap } from "../../src/registration/toolMeta.js";
import { coercedBoolean, jsonCoerce } from "../../src/shared/schemaCoercion.js";

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
