/**
 * Unit tests for schema_min.ts — stableStringify exact string comparison.
 * Byte-identical output is the contract (prompt caching).
 */
import assert from "node:assert/strict";
import { stableStringify } from "../../src/schema_min.js";

// ── Sorted keys ──────────────────────────────────────────────────────

// Keys inserted in non-alphabetical order → sorted output
{
  const obj = { zebra: 1, apple: 2, mango: 3 };
  assert.equal(stableStringify(obj), '{"apple":2,"mango":3,"zebra":1}');
}

// Already sorted → same output
{
  const obj = { a: 1, b: 2, c: 3 };
  assert.equal(stableStringify(obj), '{"a":1,"b":2,"c":3}');
}

// ── Nested objects ───────────────────────────────────────────────────

// Nested keys are also sorted
{
  const obj = { z: { b: 2, a: 1 }, a: { d: 4, c: 3 } };
  assert.equal(stableStringify(obj), '{"a":{"c":3,"d":4},"z":{"a":1,"b":2}}');
}

// Deeply nested
{
  const obj = { c: { b: { a: 1 } } };
  assert.equal(stableStringify(obj), '{"c":{"b":{"a":1}}}');
}

// ── Arrays ───────────────────────────────────────────────────────────

// Arrays preserve order (not sorted — arrays are ordered)
{
  const arr = [3, 1, 2];
  assert.equal(stableStringify(arr), "[3,1,2]");
}

// Arrays with objects — object keys sorted, array order preserved
{
  const arr = [
    { z: 1, a: 2 },
    { m: 3, b: 4 },
  ];
  assert.equal(stableStringify(arr), '[{"a":2,"z":1},{"b":4,"m":3}]');
}

// Empty array
assert.equal(stableStringify([]), "[]");

// ── Null ─────────────────────────────────────────────────────────────

assert.equal(stableStringify(null), "null");

// Null values in objects
{
  const obj = { b: null, a: 1 };
  assert.equal(stableStringify(obj), '{"a":1,"b":null}');
}

// ── Special characters ──────────────────────────────────────────────

// Strings with special chars
{
  const obj = { msg: 'Hello "world"\nnew line\ttab' };
  assert.equal(stableStringify(obj), '{"msg":"Hello \\"world\\"\\nnew line\\ttab"}');
}

// Unicode
{
  const obj = { emoji: "\u{1F680}", accent: "\u00E9" };
  const result = stableStringify(obj);
  assert.ok(result.includes("accent"));
  assert.ok(result.includes("emoji"));
  // Keys sorted: accent < emoji
  assert.ok(result.indexOf("accent") < result.indexOf("emoji"));
}

// ── Empty objects ────────────────────────────────────────────────────

assert.equal(stableStringify({}), "{}");

// ── Primitives ───────────────────────────────────────────────────────

assert.equal(stableStringify(42), "42");
assert.equal(stableStringify("hello"), '"hello"');
assert.equal(stableStringify(true), "true");
assert.equal(stableStringify(false), "false");

// ── Determinism — same input always produces same output ─────────────

{
  const obj = { port: 6550, host: "127.0.0.1", paths: ["/a", "/b"], meta: { x: 1, y: 2 } };
  const a = stableStringify(obj);
  const b = stableStringify(obj);
  const c = stableStringify(JSON.parse(JSON.stringify(obj)));
  assert.equal(a, b, "Same reference → identical");
  assert.equal(a, c, "Structurally equal → identical");
}

// ── Key insertion order doesn't matter ───────────────────────────────

{
  const obj1: Record<string, number> = {};
  obj1.z = 1;
  obj1.a = 2;

  const obj2: Record<string, number> = {};
  obj2.a = 2;
  obj2.z = 1;

  assert.equal(stableStringify(obj1), stableStringify(obj2));
}

// ── Mixed nested structure ───────────────────────────────────────────

{
  const complex = {
    tools: [{ name: "scene_get_tree", group: "scene" }],
    config: { port: 6550, debug: false },
    version: "1.0.0",
    nullField: null,
  };
  const expected =
    '{"config":{"debug":false,"port":6550},"nullField":null,"tools":[{"group":"scene","name":"scene_get_tree"}],"version":"1.0.0"}';
  assert.equal(stableStringify(complex), expected);
}

console.log("All schema_min tests passed.");
