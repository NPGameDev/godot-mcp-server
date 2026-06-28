/**
 * Unit tests for group_match.ts — the keyword-scoring pipeline behind
 * discover_tools' fuzzy search (concern 077, C2). Six blocks:
 *   1. matchKeywords weights (+3 exact / +2 contains / +1 contained len>=3),
 *      observed through findMatchesSingle on an isolated extension group.
 *   2. findMatchesSingle built-in scoring ("tilemap") + built-in tool-name-token
 *      discoverability ("input map action" → input_map) + the recall-biased
 *      dominant-match prune (keep top-1 + exact + >= score*0.5).
 *   3. Extension-group scoring + the read-only tool filter (mutation tools do
 *      not inflate the match).
 *   4. Built-in read-only filter + nonsense → [].
 *   5. capFuzzyResults round-robin + 5-total cap + 3-per-element cap +
 *      additionalCount.
 *   6. coerceRequest array / JSON-string / single-wrap / fallback.
 *
 * matchKeywords + the caps + DOMINANT_MATCH_RATIO are module-private, so their
 * weights/policy are asserted through the exported findMatchesSingle (controlled
 * extension groups give exact-score isolation). capFuzzyResults + coerceRequest
 * are exported and tested directly.
 */
import assert from "node:assert/strict";
import { findMatchesSingle, capFuzzyResults, coerceRequest } from "../../src/groups/groupMatch.js";
import { GROUPS } from "../../src/groups/groupCatalogue.js";
import { type ExtensionCmd, addExtensionGroup, clearExtensionGroups } from "../../src/groups/extensionGroups.js";
import { isAllowedInReadOnly } from "../../src/security/profiles.js";
import { ALL_TOOL_DEFS } from "../../src/registration/catalogue.js";

// Minimal ExtensionCmd with a chosen read-only annotation. Tool/method/desc are
// kept free of the query families below so the keyword term is the only scorer.
const cmd = (method: string, toolName: string, readOnly = true): ExtensionCmd => ({
  method,
  toolName,
  description: `does ${method}`,
  inputSchema: { type: "object", properties: {} },
  annotations: { readOnlyHint: readOnly },
});

// ── Block 1 — matchKeywords weights via an isolated extension group ──
// matchKeywords is private; observe its +3/+2/+1 weights through the score of a
// lone extension group whose name + command names share no substring with the
// "qwzzt" query family, so the keyword term is the ONLY score contributor.
// (No built-in group or tool name contains "qwzzt"/"qwz" → results are isolated.)
clearExtensionGroups();
{
  addExtensionGroup("kwtest", "", [cmd("m.kwt", "zzcmd_tool")], ["qwzzt"]);

  assert.deepEqual(findMatchesSingle("qwzzt", false), [{ name: "kwtest", score: 3 }], "exact (q === kw) → +3");
  assert.deepEqual(
    findMatchesSingle("qwzztx", false),
    [{ name: "kwtest", score: 2 }],
    "contains (q.includes(kw)) → +2",
  );
  assert.deepEqual(
    findMatchesSingle("qwz", false),
    [{ name: "kwtest", score: 1 }],
    "contained (kw.includes(q), len>=3) → +1",
  );
}
clearExtensionGroups();

// ── Block 1b — scoreToolNameTokens "_"→space normalization ───────────
// The shared tool-name-token scorer normalizes "_"→space on each tool name
// before its substring/exact test, so a space-bearing query matches an
// underscore tool name. Isolated on a lone extension group whose keyword + name
// share no substring with the query (the qwzzt/zzcmd families are built-in-free,
// per Block 1) → the normalized command name is the ONLY scorer. score 1 = one
// normalized-substring hit; the match also exercises the norm === q exact path.
{
  addExtensionGroup("qwznorm", "", [cmd("m.q", "qwzzt_zzcmd")], ["zznokw"]);
  assert.deepEqual(
    findMatchesSingle("qwzzt zzcmd", false),
    [{ name: "qwznorm", score: 1 }],
    'tool-name "_"→space: "qwzzt zzcmd" matches normalized "qwzzt_zzcmd"',
  );
}
clearExtensionGroups();

// ── Block 2 — built-in scoring + dominant-match prune ────────────────
{
  // Built-in: "tilemap" → the tilemap group on top with a strong (exact) score.
  assert.ok(
    GROUPS.some((g) => g.name === "tilemap"),
    "tilemap group exists in catalogue",
  );
  const tm = findMatchesSingle("tilemap", false);
  assert.ok(tm.length > 0, "tilemap → at least one match");
  assert.equal(tm[0].name, "tilemap", "tilemap → top match is the tilemap group");
  assert.ok(tm[0].score >= 3, "tilemap exact keyword scores >= 3");

  // Tool-name-derived phrase surfaces the input_map group.
  const im = findMatchesSingle("input map action", false);
  assert.ok(
    im.some((m) => m.name === "input_map"),
    "input map action → input_map group present",
  );

  // matches[0] holds the maximum score.
  for (const m of im) {
    assert.ok(m.score <= im[0].score, "top score is the maximum");
  }

  // Dominant-match prune: three extension groups, controlled scores for query
  // "ztopkey" → top=3 (exact), keep=2 (>= 0.5*3 = 1.5), drop=1 (< 1.5, not exact).
  addExtensionGroup("topg", "", [cmd("m.t", "c1_tool")], ["ztopkey"]); // exact → 3
  addExtensionGroup("keepg", "", [cmd("m.k", "c2_tool")], ["ztop"]); // contains → 2
  addExtensionGroup("dropg", "", [cmd("m.d", "c3_tool")], ["ztopkeyxx"]); // contained → 1

  const pruned = findMatchesSingle("ztopkey", false);
  const names = pruned.map((m) => m.name);
  assert.equal(names[0], "topg", "dominant: top-scorer first");
  assert.ok(names.includes("keepg"), "dominant: keeps a match >= 0.5*top");
  assert.ok(!names.includes("dropg"), "dominant: prunes a non-exact match < 0.5*top");
  assert.equal(pruned.length, 2, "dominant: exactly top + the kept one survive");
}
clearExtensionGroups();

// ── Block 3 — extension-group scoring + read-only filter ─────────────
{
  // A registered extension group surfaces by its keyword.
  addExtensionGroup("my_ext", "My extension", [cmd("ext.alpha", "ext_alpha")], ["widgetkw"]);
  assert.ok(
    findMatchesSingle("widgetkw", false).some((m) => m.name === "my_ext"),
    "extension group surfaces by keyword",
  );

  // Read-only filter: a fully-mutating extension group is filtered out under
  // readOnly; a read-only one survives — mutation tools don't inflate the match.
  addExtensionGroup("mutgrp", "", [cmd("m.mut", "mut_tool", false)], ["mutkey"]);
  addExtensionGroup("rogrp", "", [cmd("m.ro", "ro_tool", true)], ["rokey"]);

  assert.ok(
    findMatchesSingle("mutkey", false).some((m) => m.name === "mutgrp"),
    "mutating group present in full mode",
  );
  assert.ok(
    !findMatchesSingle("mutkey", true).some((m) => m.name === "mutgrp"),
    "mutating group filtered out under readOnly",
  );
  assert.ok(
    findMatchesSingle("rokey", true).some((m) => m.name === "rogrp"),
    "read-only group surfaces under readOnly",
  );
}
clearExtensionGroups();

// ── Block 4 — built-in read-only filter + nonsense ───────────────────
{
  // Nonsense keyword → no matches.
  assert.deepEqual(findMatchesSingle("zzzzzznotathing", false), [], "nonsense → []");

  // Every built-in group surfaced under readOnly carries at least one read-only
  // tool (ext registry is empty here, so all results are built-in).
  const builtinHasReadOnlyTool = (name: string): boolean => {
    const g = GROUPS.find((gr) => gr.name === name);
    if (!g) return false;
    return g.tools.some((t) => {
      const d = ALL_TOOL_DEFS.find((def) => def.name === t);
      return d ? isAllowedInReadOnly(d.annotations) : false;
    });
  };
  for (const kw of ["save", "tilemap", "animation"]) {
    for (const m of findMatchesSingle(kw, true)) {
      assert.ok(builtinHasReadOnlyTool(m.name), `readOnly "${kw}" surfaced mutation-only group "${m.name}"`);
    }
  }
}

// ── Block 5 — capFuzzyResults caps + round-robin ─────────────────────
{
  // Round-robin: each keyword's top-1 gets a slot FIRST, so a low-scoring keyword's
  // top is promoted past higher-scoring runners-up of OTHER keywords. This fixture
  // DISCRIMINATES round-robin from a pure aggregate-top-5: round-robin keeps g (k3's
  // top, score 2) and drops e (score 6); aggregate-top-5 would keep e and drop g.
  // R1 round-robin → a, d, g (each keyword's top-1); R2 aggregate fill → b(9), c(8).
  const rr = new Map<string, { name: string; score: number }[]>([
    [
      "k1",
      [
        { name: "a", score: 10 },
        { name: "b", score: 9 },
        { name: "c", score: 8 },
      ],
    ],
    [
      "k2",
      [
        { name: "d", score: 7 },
        { name: "e", score: 6 },
        { name: "f", score: 5 },
      ],
    ],
    ["k3", [{ name: "g", score: 2 }]],
  ]);
  const rrOut = capFuzzyResults(rr);
  assert.deepEqual(
    [...rrOut.selected].sort(),
    ["a", "b", "c", "d", "g"],
    "round-robin selects each keyword's top-1 first (a,d,g), then fills by score (b,c)",
  );
  assert.ok(rrOut.selected.includes("g"), "round-robin promotes k3's low top g (score 2) into the top-5");
  assert.ok(
    !rrOut.selected.includes("e"),
    "...displacing e (score 6) that a pure aggregate-top-5 would keep — proves round-robin, not aggregate",
  );
  assert.equal(rrOut.additionalCount, 2, "7 unique − 5 selected → additionalCount 2");

  // 5-total cap: 6 unique across 2 keywords → 5 selected, 1 counted as additional.
  const tot = new Map<string, { name: string; score: number }[]>([
    [
      "k1",
      [
        { name: "a", score: 9 },
        { name: "b", score: 7 },
        { name: "c", score: 5 },
      ],
    ],
    [
      "k2",
      [
        { name: "d", score: 8 },
        { name: "e", score: 6 },
        { name: "f", score: 4 },
      ],
    ],
  ]);
  const totOut = capFuzzyResults(tot);
  assert.equal(totOut.selected.length, 5, "5-total cap: only 5 selected");
  assert.ok(
    totOut.selected.includes("a") && totOut.selected.includes("d"),
    "5-total cap: top-5 kept (both keyword tops among them)",
  );
  assert.equal(totOut.additionalCount, 1, "additionalCount = 6 unique − 5 selected");

  // 3-per-element cap: a 4th candidate for one keyword is dropped from selection
  // but still counted in additionalCount (allUnique counts pre-cap).
  const perEl = new Map<string, { name: string; score: number }[]>([
    [
      "k1",
      [
        { name: "a", score: 4 },
        { name: "b", score: 3 },
        { name: "c", score: 2 },
        { name: "d", score: 1 },
      ],
    ],
  ]);
  const perElOut = capFuzzyResults(perEl);
  assert.deepEqual(perElOut.selected, ["a", "b", "c"], "3-per-element cap: 4th dropped from selection");
  assert.equal(perElOut.additionalCount, 1, "3-per-element cap: pre-cap 4th counted in additionalCount");
}

// ── Block 6 — coerceRequest ──────────────────────────────────────────
{
  assert.deepEqual(coerceRequest(["a", "b"]), ["a", "b"], "array passthrough");
  assert.deepEqual(coerceRequest('["x","y"]'), ["x", "y"], "'['-prefixed JSON-array string parsed");
  assert.deepEqual(coerceRequest("[1,2]"), ["1", "2"], "JSON array coerced to strings");
  assert.deepEqual(coerceRequest("single"), ["single"], "single string wrapped");
  assert.deepEqual(coerceRequest("[not valid json"), ["[not valid json"], "malformed '['-string → wrapped (fallback)");
}

console.log("All group_match tests passed.");
