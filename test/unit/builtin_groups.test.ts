/**
 * Unit tests for builtin_groups.ts — the eager-assembly module that imports the
 * 28 per-group data modules (src/groups/*) and assembles the canonical ordered
 * GROUPS array (concern 094, C1). A belt-and-suspenders "forgotten-module" guard:
 * if a per-group file is dropped from (or duplicated in) the assembly, or a def
 * is malformed, these assertions fail independently of group_catalogue.ts.
 *   1. GROUPS assembles exactly 28 entries, with unique names.
 *   2. Every assembled name is a canonical GroupName (∈ GROUP_NAMES).
 *   3. Every entry has the GroupDef shape (non-empty name/description/tools).
 *   4. GROUPS assembles in the canonical PINNED order, and GROUP_NAMES (derived
 *      from GROUPS in concern 094, C2) matches it element-for-element.
 */
import assert from "node:assert/strict";
import { GROUPS } from "../../src/builtin_groups.js";
import { GROUP_NAMES } from "../../src/group_catalogue.js";

// ── Block 1 — assembly count + uniqueness ────────────────────────────

{
  assert.equal(GROUPS.length, 28, "builtin_groups assembles exactly 28 groups");
  const names = GROUPS.map((g) => g.name);
  assert.equal(new Set(names).size, names.length, "no group is duplicated in the assembly");
}

// ── Block 2 — names are canonical GroupNames ─────────────────────────

{
  const canonical = new Set<string>(GROUP_NAMES);
  for (const g of GROUPS) {
    assert.ok(canonical.has(g.name), `assembled group "${g.name}" is not a canonical GroupName`);
  }
  // Every canonical name is also represented in the assembly (no group dropped).
  assert.equal(
    new Set(GROUPS.map((g) => g.name)).size,
    GROUP_NAMES.length,
    "assembly covers every canonical GroupName",
  );
}

// ── Block 3 — every entry has the GroupDef shape ─────────────────────

{
  for (const g of GROUPS) {
    assert.ok(typeof g.name === "string" && g.name.length > 0, "group name must be a non-empty string");
    assert.ok(
      typeof g.description === "string" && g.description.length > 0,
      `${g.name}: description must be non-empty`,
    );
    assert.ok(Array.isArray(g.tools) && g.tools.length > 0, `${g.name}: tools must be a non-empty array`);
    assert.ok(Array.isArray(g.keywords), `${g.name}: keywords must be an array`);
  }
}

// ── Block 4 — GROUPS order is pinned (loud gate against silent reorder) ──

{
  // The assembly order in builtin_groups.ts is the SSOT for discover_tools
  // enumeration and every derived index; pin it byte-for-byte so any reorder
  // (or an added/dropped group) trips here loudly. placeholders is 7th; classdb
  // is last.
  assert.deepEqual(
    GROUPS.map((g) => g.name),
    [
      "runtime_advanced",
      "signals",
      "animation_authoring",
      "input_map",
      "resource_io",
      "asset_ops",
      "placeholders",
      "cleanup",
      "user_data",
      "scene_advanced",
      "editor_advanced",
      "tilemap",
      "tileset",
      "tileset_edit",
      "theme",
      "layer_naming",
      "path_editing",
      "3d_tools",
      "procedural",
      "scene_inheritance",
      "audio",
      "spriteframes",
      "particles",
      "navigation",
      "lsp_code_analysis",
      "lsp_code_navigation",
      "debugger",
      "classdb",
    ],
    "GROUPS assembles in the canonical pinned order",
  );

  // GROUP_NAMES is derived from GROUPS (concern 094, C2), so it must equal the
  // assembly order element-for-element — not merely as a set.
  assert.deepEqual(
    [...GROUP_NAMES],
    GROUPS.map((g) => g.name),
    "GROUP_NAMES is derived from GROUPS (order-identical)",
  );
}

console.log("All builtin_groups tests passed.");
