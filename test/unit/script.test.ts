/**
 * Unit tests for script.ts — the `script_edit` input shape the server validates.
 *
 * The smoke section for `script_edit` talks to the toolkit directly and never
 * passes through this schema, so these tests pin what the server itself accepts:
 * an `edits` array alone, with `old_string` and `new_string` left out. A schema
 * that drops `edits` or still requires `old_string` would reject or empty such a
 * call before it reaches the editor.
 */
import assert from "node:assert/strict";
import { z } from "zod";
import { ALL_TOOL_DEFS } from "../../src/registration/catalogue.js";
import { addStringCoercion } from "../../src/shared/schemaCoercion.js";

// Parse arguments the way registration does: the catalogue shape, string coercion applied.
function scriptEditSchema(): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const def = ALL_TOOL_DEFS.find((t) => t.name === "script_edit");
  assert.ok(def, "script_edit present in the catalogue");
  return z.object(addStringCoercion(def.inputSchema as Record<string, z.ZodTypeAny>));
}

const EDITS = [
  { old_string: "func old_name()", new_string: "func new_name()" },
  { old_string: "-> int", new_string: "-> float", replace_all: true },
];

// ── edits alone ──────────────────────────────────────────────────────

// A call with only file_path and edits parses, and edits survives intact.
{
  const parsed = scriptEditSchema().safeParse({ file_path: "res://a.gd", edits: EDITS });
  assert.ok(parsed.success, `edits alone parses: ${JSON.stringify(parsed.error?.issues)}`);
  assert.deepEqual(parsed.data.edits, EDITS, "edits is kept, replace_all included");
  assert.ok(!("old_string" in parsed.data), "no old_string is added");
}

// An edits array sent as a JSON string parses to the same array.
{
  const parsed = scriptEditSchema().safeParse({ file_path: "res://a.gd", edits: JSON.stringify(EDITS) });
  assert.ok(parsed.success, "stringified edits parses");
  assert.deepEqual(parsed.data.edits, EDITS);
}

// An empty edits array fails to parse.
assert.ok(!scriptEditSchema().safeParse({ file_path: "res://a.gd", edits: [] }).success, "empty edits is rejected");

// ── the single form ──────────────────────────────────────────────────

// old_string and new_string stay accepted, and only file_path is required.
{
  const single = { file_path: "res://a.gd", old_string: "return 1", new_string: "return 2" };
  const parsed = scriptEditSchema().safeParse(single);
  assert.ok(parsed.success, "the single form parses");
  assert.deepEqual(parsed.data, single);

  const advertised = z.toJSONSchema(scriptEditSchema(), { io: "input" }) as { required?: string[] };
  assert.deepEqual(advertised.required, ["file_path"], "old_string and new_string are optional");
}

console.log("All 4 tests passed.");
