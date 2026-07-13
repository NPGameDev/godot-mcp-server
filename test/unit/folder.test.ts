/**
 * Unit tests for folder.ts — the advertised schema of the folder tools.
 *
 * The folder tools take a single filesystem path advertised as `path` (unique
 * to these two tools; every other path-bearing tool keeps a prefixed name such
 * as `file_path`). These tests pin that advertised shape so a drift back to the
 * former `folder_path` name is caught before it reaches a client.
 */
import assert from "node:assert/strict";
import { z } from "zod";
import { folderTools } from "../../src/tools/folder.js";

// The advertised schema is what `tools/list` emits: z.toJSONSchema(z.object(shape)).
function advertisedSchema(name: string): Record<string, unknown> {
  const def = folderTools.find((t) => t.name === name);
  assert.ok(def, `${name} present in folderTools`);
  return z.toJSONSchema(z.object(def.inputSchema)) as Record<string, unknown>;
}

// ── folder_create ────────────────────────────────────────────────────

// Advertises `path` as the only property, and it is required.
{
  const schema = advertisedSchema("folder_create");
  const properties = schema.properties as Record<string, unknown>;
  assert.deepEqual(Object.keys(properties), ["path"]);
  assert.deepEqual(schema.required, ["path"]);
  assert.ok(!("folder_path" in properties), "folder_path is not advertised");
}

// ── folder_delete ────────────────────────────────────────────────────

// Advertises `path` (required) and `recursive` (optional); no folder_path.
{
  const schema = advertisedSchema("folder_delete");
  const properties = schema.properties as Record<string, unknown>;
  assert.deepEqual(Object.keys(properties).sort(), ["path", "recursive"]);
  assert.deepEqual(schema.required, ["path"], "only path is required");
  assert.ok(!("folder_path" in properties), "folder_path is not advertised");
}

// ── Path guards track the advertised name ─────────────────────────────

// The path guard names the advertised param, else pre-filtering misses it.
{
  for (const name of ["folder_create", "folder_delete"]) {
    const def = folderTools.find((t) => t.name === name);
    assert.ok(def);
    const guarded = (def.pathParams ?? []).map((p) => p.param);
    assert.deepEqual(guarded, ["path"], `${name} guards path`);
  }
}

console.log("All 3 tests passed.");
