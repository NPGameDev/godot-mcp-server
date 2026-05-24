/**
 * Unit tests for LLM string coercion — pre-Zod preprocessing that
 * parses JSON-encoded strings when the schema expects non-string types.
 */
import assert from "node:assert/strict";
import { z } from "zod";
import { coerceStringValue, innerZodType, addStringCoercion, coercedBoolean } from "../../src/tool_helpers.js";

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

console.log("All string_coercion tests passed.");
