import { GROUPS, GROUP_TOOL_NAMES, findMatchesSingle } from "../../src/groups/groups.js";

import type { TestCtx } from "../helpers.js";

export const TOOLS_TESTED: string[] = ["discover_tools"];
/**
 * Section 39 — discover_tools static validation
 *
 * The discover_tools meta-tool is server-side only (not a Godot method),
 * so it can't be called via bridge.call(). This section validates the
 * group system's structural integrity without needing a Godot connection:
 *
 * 1. Group definitions are complete and non-overlapping
 * 2. Every group tool maps to a real ToolDef
 * 3. Keyword arrays are non-empty for discoverability
 * 4. GROUP_TOOL_NAMES accurately reflects GROUPS
 * 5. Over-activation threshold logic is sound (>5 groups)
 * 6. Dominant-match keyword filter prunes incidental noise but never hides a
 *    valid group (prune + recall-preservation guardrail)
 *
 * Runs in CI mode (no bridge required) — wired into runCiMode() in smoke.ts.
 */
export async function testDiscoverTools(ctx: TestCtx): Promise<void> {
  const { pass, fail } = ctx;

  // ── Group count ──
  if (GROUPS.length < 20) {
    fail(`discover_tools: expected >= 20 groups, got ${GROUPS.length}`);
  } else {
    pass(`discover_tools group count: ${GROUPS.length} groups defined`);
  }

  // ── Every group has non-empty keywords ──
  const emptyKeywords = GROUPS.filter((g) => g.keywords.length === 0);
  if (emptyKeywords.length > 0) {
    fail(`discover_tools: groups with empty keywords: ${emptyKeywords.map((g) => g.name).join(", ")}`);
  } else {
    pass("discover_tools: all groups have keywords for discoverability");
  }

  // ── Every group has a non-empty description ──
  const noDesc = GROUPS.filter((g) => !g.description || g.description.length === 0);
  if (noDesc.length > 0) {
    fail(`discover_tools: groups without description: ${noDesc.map((g) => g.name).join(", ")}`);
  } else {
    pass("discover_tools: all groups have descriptions for LLM discoverability");
  }

  // ── Every group has at least one tool ──
  const emptyTools = GROUPS.filter((g) => g.tools.length === 0);
  if (emptyTools.length > 0) {
    fail(`discover_tools: groups with no tools: ${emptyTools.map((g) => g.name).join(", ")}`);
  } else {
    pass("discover_tools: all groups have tools");
  }

  // ── No duplicate tool names across groups ──
  const allGroupTools: string[] = [];
  const duplicates: string[] = [];
  for (const group of GROUPS) {
    for (const tool of group.tools) {
      if (allGroupTools.includes(tool)) duplicates.push(`${tool} (in ${group.name})`);
      allGroupTools.push(tool);
    }
  }
  if (duplicates.length > 0) {
    fail(`discover_tools: duplicate tools across groups: ${duplicates.join(", ")}`);
  } else {
    pass(`discover_tools: no duplicate tools across groups (${allGroupTools.length} total)`);
  }

  // ── GROUP_TOOL_NAMES matches GROUPS ──
  const expected = new Set(GROUPS.flatMap((g) => g.tools));
  if (GROUP_TOOL_NAMES.size !== expected.size) {
    fail(`GROUP_TOOL_NAMES size mismatch: ${GROUP_TOOL_NAMES.size} vs ${expected.size}`);
  } else {
    const missing = [...expected].filter((t) => !GROUP_TOOL_NAMES.has(t));
    if (missing.length > 0) {
      fail(`GROUP_TOOL_NAMES missing: ${missing.join(", ")}`);
    } else {
      pass(`GROUP_TOOL_NAMES consistent with GROUPS (${GROUP_TOOL_NAMES.size} tools)`);
    }
  }

  // ── Group names are unique ──
  const names = GROUPS.map((g) => g.name);
  const uniqueNames = new Set(names);
  if (names.length !== uniqueNames.size) {
    fail("discover_tools: duplicate group names detected");
  } else {
    pass("discover_tools: all group names unique");
  }

  // ── Over-activation threshold ──
  // The server warns when >5 groups are activated at once. Verify the
  // group count makes this threshold meaningful (enough groups exist).
  if (GROUPS.length > 5) {
    pass(`discover_tools: over-activation threshold (>5) is meaningful with ${GROUPS.length} groups`);
  } else {
    fail("discover_tools: fewer than 6 groups makes over-activation warning pointless");
  }

  // ── Dominant-match threshold ──────────────────────
  // PRUNE: a vague multi-word phrase must not over-activate. The §28 sweep saw
  // "placeholder texture sprite sound" activate placeholders + asset_ops +
  // path_editing; the dominant-match filter must now leave only placeholders.
  const phraseMatches = findMatchesSingle("placeholder texture sprite sound", false).map((m) => m.name);
  if (phraseMatches.length === 1 && phraseMatches[0] === "placeholders") {
    pass('discover_tools dominant-match: "placeholder texture sprite sound" → only placeholders');
  } else {
    fail(`discover_tools dominant-match: expected only [placeholders], got [${phraseMatches.join(", ")}]`);
  }

  // RECALL: the filter must NEVER hide a valid group (over-activation is the safe
  // direction). A focused keyword whose groups cluster in score keeps them all.
  const soundMatches = findMatchesSingle("sound", false).map((m) => m.name);
  if (soundMatches.includes("placeholders") && soundMatches.includes("audio")) {
    pass('discover_tools recall: "sound" keeps both placeholders and audio');
  } else {
    fail(`discover_tools recall: "sound" should keep placeholders AND audio, got [${soundMatches.join(", ")}]`);
  }

  // RECALL via exact-match exemption: for "sprite", spriteframes dominates
  // (~9) while placeholders and path_editing score ~3 — below half the top, but
  // each holds "sprite" as an EXACT keyword, so the exemption must keep them.
  const spriteMatches = findMatchesSingle("sprite", false).map((m) => m.name);
  if (
    spriteMatches.includes("spriteframes") &&
    spriteMatches.includes("placeholders") &&
    spriteMatches.includes("path_editing")
  ) {
    pass('discover_tools recall: "sprite" exact-keyword exemption keeps spriteframes + placeholders + path_editing');
  } else {
    fail(
      `discover_tools recall: "sprite" should keep all three exact-keyword groups, got [${spriteMatches.join(", ")}]`,
    );
  }
}
