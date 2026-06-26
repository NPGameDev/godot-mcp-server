/**
 * Unit tests for server_mode.ts — the MODULE_ALLOWED registration input.
 *
 * MODULE_ALLOWED is the standard tool set minus group-managed tools: the set
 * handed to registerBuiltinModules at eager registration. Concern 090 collapsed
 * the former refreshMode() cache into this single computed-once constant; these
 * pins assert its invariant relationship to resolveAllowedTools() and
 * GROUP_TOOL_NAMES (derived from the catalogue — no brittle hardcoded lists).
 */
import assert from "node:assert/strict";
import { MODULE_ALLOWED } from "../../src/server_mode.js";
import { GROUP_TOOL_NAMES } from "../../src/groups.js";
import { resolveAllowedTools } from "../../src/profiles.js";

// ── Shape ────────────────────────────────────────────────────────────

assert.ok(MODULE_ALLOWED instanceof Set, "MODULE_ALLOWED is a Set");
assert.ok(MODULE_ALLOWED.size > 0, "MODULE_ALLOWED is non-empty");

// ── No group tool leaks into the eager module set ────────────────────

for (const name of GROUP_TOOL_NAMES) {
  assert.equal(MODULE_ALLOWED.has(name), false, `group tool "${name}" must not be in MODULE_ALLOWED`);
}

// ── MODULE_ALLOWED === resolveAllowedTools() minus GROUP_TOOL_NAMES ───

{
  const standard = resolveAllowedTools();

  // (a) Subset: every member of MODULE_ALLOWED is a standard tool.
  for (const name of MODULE_ALLOWED) {
    assert.ok(standard.has(name), `MODULE_ALLOWED member "${name}" must be a standard tool`);
  }

  // (b) Completeness: every standard tool that is NOT a group tool is present.
  for (const name of standard) {
    if (GROUP_TOOL_NAMES.has(name)) continue;
    assert.ok(MODULE_ALLOWED.has(name), `standard non-group tool "${name}" missing from MODULE_ALLOWED`);
  }

  // (c) Exact size: |standard| minus |standard ∩ group tools|.
  const overlap = [...standard].filter((n) => GROUP_TOOL_NAMES.has(n)).length;
  assert.equal(
    MODULE_ALLOWED.size,
    standard.size - overlap,
    "MODULE_ALLOWED size == standard tools minus group-tool overlap",
  );
}

console.log("All server_mode tests passed.");
