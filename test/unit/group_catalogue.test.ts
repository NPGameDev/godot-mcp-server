/**
 * Unit tests for group_catalogue.ts — the pure-data leaf carved out of groups.ts
 * (concern 077, C0). Asserts the static catalogue's derived invariants against
 * the live GROUPS literal and the canonical ALL_TOOL_DEFS:
 *   1. GROUPS shape (exactly 28 entries, names unique).
 *   2. allDefs name→def lookup round-trips + covers every group tool.
 *   3. GROUP_TOOL_NAMES is the de-duped union of every group's tools.
 *   4. RUNTIME_TOOLS / LSP_TOOLS hold their exact members, all catalogue-resolvable.
 *   5. GROUP_NAMES enumerates exactly the GROUPS names (set equality).
 */
import assert from "node:assert/strict";
import { GROUPS, GROUP_NAMES, GROUP_TOOL_NAMES, RUNTIME_TOOLS, LSP_TOOLS, allDefs } from "../../src/group_catalogue.js";
import { ALL_TOOL_DEFS } from "../../src/catalogue.js";

// ── Block 1 — GROUPS integrity ───────────────────────────────────────

{
  assert.equal(GROUPS.length, 28, "GROUPS has exactly 28 entries");
  const names = GROUPS.map((g) => g.name);
  assert.equal(new Set(names).size, names.length, "group names are unique (no duplicate group)");
}

// ── Block 2 — allDefs lookup round-trip ──────────────────────────────

{
  // A real tool name drawn from the catalogue resolves to its own def.
  const sample = GROUPS[0].tools[0];
  const def = allDefs.get(sample);
  assert.ok(def, `allDefs resolves the sampled tool "${sample}"`);
  assert.equal(def!.name, sample, "allDefs.get(name).name round-trips");

  // allDefs derives from ALL_TOOL_DEFS, so every group tool is resolvable.
  for (const t of GROUP_TOOL_NAMES) {
    assert.ok(allDefs.get(t), `allDefs missing group tool "${t}"`);
  }
}

// ── Block 3 — GROUP_TOOL_NAMES = de-duped union of group tools ───────

{
  const union = new Set<string>();
  for (const g of GROUPS) for (const t of g.tools) union.add(t);
  assert.equal(GROUP_TOOL_NAMES.size, union.size, "GROUP_TOOL_NAMES is de-duped (size matches the union)");
  assert.deepEqual(
    [...GROUP_TOOL_NAMES].sort(),
    [...union].sort(),
    "GROUP_TOOL_NAMES equals the union of every group's tools",
  );
}

// ── Block 4 — RUNTIME_TOOLS / LSP_TOOLS members + resolvability ──────

{
  const allNames = new Set(ALL_TOOL_DEFS.map((t) => t.name));

  assert.deepEqual(
    [...RUNTIME_TOOLS].sort(),
    ["animation_player_control", "runtime_get_node_state", "runtime_set_property"],
    "RUNTIME_TOOLS holds exactly its 3 runtime-bridge tools",
  );
  assert.deepEqual(
    [...LSP_TOOLS].sort(),
    ["lsp_completion", "lsp_definition", "lsp_diagnostics", "lsp_hover", "lsp_references", "lsp_symbols"],
    "LSP_TOOLS holds exactly its 6 language-server tools",
  );

  for (const t of [...RUNTIME_TOOLS, ...LSP_TOOLS]) {
    assert.ok(allNames.has(t), `runtime/lsp tool "${t}" not resolvable in ALL_TOOL_DEFS`);
  }
}

// ── Block 5 — GROUP_NAMES enumerates exactly the GROUPS names ─────────

{
  // GROUP_NAMES is now DERIVED from GROUPS (concern 094, C2), so the two list the
  // same group names in the same order by construction. This assertion stays a
  // deliberately order-INDEPENDENT SET equality (both sides .sort()ed): it pins
  // the membership invariant — every GROUPS name is in GROUP_NAMES and vice
  // versa, no extras or omissions — while the element-for-element order is
  // guarded separately by the builtin_groups order-pinning test.
  assert.equal(GROUP_NAMES.length, GROUPS.length, "GROUP_NAMES has one entry per group");
  assert.deepEqual(
    [...GROUP_NAMES].sort(),
    GROUPS.map((g) => g.name).sort(),
    "GROUP_NAMES enumerates exactly the GROUPS names",
  );
}

console.log("All group_catalogue tests passed.");
