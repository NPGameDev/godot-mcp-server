/**
 * Unit tests for LLM string coercion — pre-Zod preprocessing that
 * parses JSON-encoded strings when the schema expects non-string types.
 */
import assert from "node:assert/strict";
import { z } from "zod";
import {
  coerceStringValue,
  innerZodType,
  addStringCoercion,
  coercedBoolean,
  jsonCoerce,
} from "../../src/shared/schemaCoercion.js";

// ── coerceStringValue ───────────────────────────────────────────────

// Non-string values pass through unchanged
{
  assert.equal(coerceStringValue(42), 42);
  assert.equal(coerceStringValue(true), true);
  assert.equal(coerceStringValue(null), null);
  assert.deepEqual(coerceStringValue([1, 2]), [1, 2]);
  assert.deepEqual(coerceStringValue({ a: 1 }), { a: 1 });
}

// JSON-encoded arrays are parsed
{
  assert.deepEqual(coerceStringValue('[{"name":"idle"}]'), [{ name: "idle" }]);
  assert.deepEqual(coerceStringValue("[1,2,3]"), [1, 2, 3]);
}

// JSON-encoded objects are parsed
{
  assert.deepEqual(coerceStringValue('{"type":"Reverb"}'), { type: "Reverb" });
}

// JSON-encoded numbers are parsed
{
  assert.equal(coerceStringValue("-6.0"), -6.0);
  assert.equal(coerceStringValue("42"), 42);
  assert.equal(coerceStringValue("0"), 0);
}

// JSON-encoded booleans are parsed
{
  assert.equal(coerceStringValue("true"), true);
  assert.equal(coerceStringValue("false"), false);
}

// Plain strings are NOT parsed (no leading JSON character)
{
  assert.equal(coerceStringValue("hello"), "hello");
  assert.equal(coerceStringValue("res://icon.svg"), "res://icon.svg");
  assert.equal(coerceStringValue("Main/Player"), "Main/Player");
  assert.equal(coerceStringValue(""), "");
  assert.equal(coerceStringValue("  "), "  ");
}

// Invalid JSON that looks like it could be JSON — returns original string
{
  assert.equal(coerceStringValue("[invalid"), "[invalid");
  assert.equal(coerceStringValue("{bad json}"), "{bad json}");
}

// JSON-encoded strings (double-quoted) — parsed to string (harmless)
{
  assert.equal(coerceStringValue('"hello"'), "hello");
}

// null literal
{
  assert.equal(coerceStringValue("null"), null);
}

// Whitespace-padded JSON
{
  assert.deepEqual(coerceStringValue("  [1, 2]  "), [1, 2]);
  assert.equal(coerceStringValue("  42  "), 42);
}

// ── innerZodType ────────────────────────────────────────────────────

// Basic types
{
  assert.equal(innerZodType(z.string()), "string");
  assert.equal(innerZodType(z.number()), "number");
  assert.equal(innerZodType(z.boolean()), "boolean");
  assert.equal(innerZodType(z.array(z.string())), "array");
  assert.equal(innerZodType(z.object({})), "object");
  assert.equal(innerZodType(z.enum(["a", "b"])), "enum");
}

// Wrapped types unwrap correctly
{
  assert.equal(innerZodType(z.number().optional()), "number");
  assert.equal(innerZodType(z.string().optional()), "string");
  assert.equal(innerZodType(z.string().optional().describe("test")), "string");
  assert.equal(innerZodType(z.array(z.number()).optional()), "array");
}

// Preprocessed types (pipe) — coercedBoolean, z.preprocess
{
  assert.equal(innerZodType(coercedBoolean()), "pipe");
  assert.equal(innerZodType(z.preprocess((v) => v, z.number())), "pipe");
}

// z.coerce.number() — resolves to number (already handles coercion)
{
  assert.equal(innerZodType(z.coerce.number()), "number");
}

// ── addStringCoercion (skip/coerce decision) ────────────────────────
// Tests that the right schemas get coercion and the right ones are
// left alone. We verify the decision, not Zod's parsing.

// String schemas are skipped (innerZodType = "string")
{
  const shape = addStringCoercion({ name: z.string() });
  assert.equal(innerZodType(shape.name), "string", "string schema should NOT be wrapped");
}

// Enum schemas are skipped (innerZodType = "enum")
{
  const shape = addStringCoercion({ mode: z.enum(["a", "b"]) });
  assert.equal(innerZodType(shape.mode), "enum", "enum schema should NOT be wrapped");
}

// Pipe schemas (coercedBoolean) are skipped (innerZodType = "pipe")
{
  const shape = addStringCoercion({ flag: coercedBoolean() });
  assert.equal(innerZodType(shape.flag), "pipe", "pipe schema should NOT be wrapped");
}

// Number schemas ARE wrapped (innerZodType becomes "pipe" from preprocess)
{
  const shape = addStringCoercion({ offset: z.number() });
  assert.equal(innerZodType(shape.offset), "pipe", "number schema should be wrapped with preprocess");
}

// Array schemas ARE wrapped
{
  const shape = addStringCoercion({ items: z.array(z.string()) });
  assert.equal(innerZodType(shape.items), "pipe", "array schema should be wrapped with preprocess");
}

// Object schemas ARE wrapped
{
  const shape = addStringCoercion({ effect: z.object({ type: z.string() }) });
  assert.equal(innerZodType(shape.effect), "pipe", "object schema should be wrapped with preprocess");
}

// Optional number schemas ARE wrapped
{
  const shape = addStringCoercion({ offset: z.number().optional() });
  assert.equal(innerZodType(shape.offset), "pipe", "optional number should be wrapped");
}

// Mixed schema: verify correct skip/coerce per key
{
  const shape = addStringCoercion({
    name: z.string(),
    count: z.number(),
    items: z.array(z.number()),
    mode: z.enum(["a", "b"]),
    enabled: coercedBoolean(),
  });
  assert.equal(innerZodType(shape.name), "string", "string key skipped");
  assert.equal(innerZodType(shape.count), "pipe", "number key wrapped");
  assert.equal(innerZodType(shape.items), "pipe", "array key wrapped");
  assert.equal(innerZodType(shape.mode), "enum", "enum key skipped");
  assert.equal(innerZodType(shape.enabled), "pipe", "pipe key skipped (stays pipe)");
}

// ── addStringCoercion preserves optionality in the emitted JSON Schema ──
// z.preprocess() is a ZodPipe, not a ZodOptional, so wrapping an
// optional field for string-coercion flipped it to `required` in the emitted
// tools/list schema (e.g. scene_spatial_map advertised radius/max_nodes as
// required even though the handler treats them as optional). Coercion must not
// change which params are required.
{
  const coerced = addStringCoercion({
    req: z.coerce.number(), // required
    optNum: z.coerce.number().optional(), // optional number (wrapped)
    optArr: z.array(z.number()).optional(), // optional array (wrapped)
    optObj: z.object({ a: z.number() }).optional(), // optional object (wrapped)
  });
  // io:"input" matches the MCP SDK's conversion (pipeStrategy "input" in
  // zod-json-schema-compat). With io:"output" the inner .optional() is
  // respected and the bug is invisible — the live tools/list uses input.
  const json = z.toJSONSchema(z.object(coerced), { io: "input" }) as { required?: string[] };
  const required = new Set(json.required ?? []);
  assert.ok(required.has("req"), "required coerced field must stay required");
  assert.ok(!required.has("optNum"), "optional coerced number must NOT be required");
  assert.ok(!required.has("optArr"), "optional coerced array must NOT be required");
  assert.ok(!required.has("optObj"), "optional coerced object must NOT be required");

  // Coercion still fires on provided JSON-string values:
  const obj = z.object(coerced);
  const parsed = obj.parse({ req: "5", optNum: "7", optArr: "[1,2]", optObj: '{"a":3}' });
  assert.equal(parsed.req, 5);
  assert.equal(parsed.optNum, 7);
  assert.deepEqual(parsed.optArr, [1, 2]);
  assert.deepEqual(parsed.optObj, { a: 3 });

  // Omitting optionals is accepted (they stay undefined):
  assert.deepEqual(obj.parse({ req: "5" }), { req: 5 });
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

console.log("All string_coercion tests passed.");
