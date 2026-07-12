/**
 * Unit tests for buildEagerManifest() — the static built-in tool manifest by
 * name that backs the --list-eager CLI flag.
 *
 * The manifest is the integration surface a downstream extractor cross-checks a
 * build transcript against, so these pins guard the exact contract: top-level
 * keys, deterministic sorting, and the eager/meta/group partition derived from
 * the same catalogue sets --tools-count counts (no hardcoded name lists).
 */
import assert from "node:assert/strict";
import { buildEagerManifest } from "../../src/startup/startupEnv.js";
import { ALL_TOOL_DEFS, META_TOOL_NAMES } from "../../src/registration/catalogue.js";
import { GROUP_TOOL_NAMES, GROUPS } from "../../src/groups/groups.js";
import { MODULE_ALLOWED } from "../../src/startup/serverMode.js";

const manifest = buildEagerManifest();

// ── Top-level shape: exactly eager / meta / groups ───────────────────

assert.deepEqual(
  Object.keys(manifest).sort(),
  ["eager", "groups", "meta"],
  "top-level keys are exactly eager/meta/groups",
);

// ── eager: sorted, matches the eagerly-registered set ────────────────

{
  assert.ok(Array.isArray(manifest.eager), "eager is an array");
  assert.deepEqual(manifest.eager, [...manifest.eager].sort(), "eager is ascending-sorted");
  assert.equal(manifest.eager.length, MODULE_ALLOWED.size, "eager length matches MODULE_ALLOWED");
  for (const name of MODULE_ALLOWED) {
    assert.ok(manifest.eager.includes(name), `eager includes registered tool "${name}"`);
  }
  // Representative eager tools that must be present.
  for (const name of ["execute_code", "node_call_method", "scene_get_tree"]) {
    assert.ok(manifest.eager.includes(name), `eager includes "${name}"`);
  }
  // No group tool and no meta name leaks into the eager list.
  for (const name of manifest.eager) {
    assert.equal(GROUP_TOOL_NAMES.has(name), false, `eager tool "${name}" is not a group tool`);
    assert.equal(META_TOOL_NAMES.includes(name), false, `eager tool "${name}" is not a meta tool`);
  }
}

// ── meta: the two always-on meta tools, sorted ───────────────────────

assert.deepEqual(manifest.meta, [...META_TOOL_NAMES].sort(), "meta is the sorted meta-tool set");
assert.deepEqual(
  manifest.meta,
  ["discover_tools", "extensions_refresh"],
  "meta names are discover_tools + extensions_refresh",
);

// ── groups: sorted keys, each a sorted non-empty tool list ───────────

{
  const groupNames = Object.keys(manifest.groups);
  assert.equal(groupNames.length, GROUPS.length, "one groups entry per registered group");
  assert.deepEqual(groupNames, [...groupNames].sort(), "groups keys are ascending-sorted");

  const unionTools = new Set<string>();
  for (const name of groupNames) {
    const tools = manifest.groups[name];
    assert.ok(tools.length > 0, `group "${name}" is non-empty`);
    assert.deepEqual(tools, [...tools].sort(), `group "${name}" tools are ascending-sorted`);
    for (const tool of tools) {
      assert.equal(manifest.eager.includes(tool), false, `group tool "${tool}" is disjoint from eager`);
      unionTools.add(tool);
    }
  }

  // The union of all group tools equals GROUP_TOOL_NAMES exactly.
  assert.equal(unionTools.size, GROUP_TOOL_NAMES.size, "group-tool union size matches GROUP_TOOL_NAMES");
  for (const name of GROUP_TOOL_NAMES) {
    assert.ok(unionTools.has(name), `GROUP_TOOL_NAMES member "${name}" appears in a group`);
  }
}

// ── Partition closes: |eager| + |group tools| == |ALL_TOOL_DEFS| ─────

assert.equal(
  manifest.eager.length + GROUP_TOOL_NAMES.size,
  ALL_TOOL_DEFS.length,
  "eager + group tools account for every catalogue tool",
);

console.log("All eager-manifest tests passed.");
