/**
 * Unit tests for groups.ts — the lazy-load tool-group system that backs the
 * decompose. Four blocks:
 *   1. Static catalogue invariants (group shape, membership, no cross-group dup).
 *   2. findMatchesSingle keyword scoring + read-only filter contract.
 *   3. Extension-group registry (add / dedupe-by-method / remove).
 *   4. The discover_tools activation flow end-to-end via a fake server + bridge —
 *      activation registers tools + marks loadedGroups; deactivation unregisters.
 *
 * findMatchesSingle is exported; the activation internals are reached only
 * through the discover_tools handler installed by registerGroupSystem.
 */
import assert from "node:assert/strict";
import {
  GROUPS,
  GROUP_TOOL_NAMES,
  RUNTIME_TOOLS,
  LSP_TOOLS,
  findMatchesSingle,
  addExtensionGroup,
  removeExtensionGroup,
  removeExtensionCommand,
  hasExtensionGroups,
  resetLoadedGroups,
  registerGroupSystem,
  type ExtensionCmd,
} from "../../src/groups.js";
import { ALL_TOOL_DEFS } from "../../src/catalogue.js";
import { isAllowedInReadOnly } from "../../src/profiles.js";
import { isGroupLoaded } from "../../src/group_state.js";
import { hasToolRef, removeAllToolRefs } from "../../src/tool_refs.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Bridge } from "../../src/types.js";

const allNames = new Set(ALL_TOOL_DEFS.map((t) => t.name));

// ── Block 1 — static catalogue invariants ────────────────────────────

{
  assert.ok(GROUPS.length > 0, "GROUPS must be non-empty");

  for (const g of GROUPS) {
    assert.ok(g.name.length > 0, "group name non-empty");
    assert.ok(g.description.length > 0, `group ${g.name}: description non-empty`);
    assert.ok(g.tools.length > 0, `group ${g.name}: tools non-empty`);
    assert.ok(g.keywords.length > 0, `group ${g.name}: keywords non-empty`);
    for (const t of g.tools) {
      assert.ok(allNames.has(t), `group ${g.name}: tool "${t}" not in ALL_TOOL_DEFS`);
    }
  }

  // GROUP_TOOL_NAMES is the de-duped union of every group's tools.
  const union = new Set(GROUPS.flatMap((g) => g.tools));
  assert.equal(GROUP_TOOL_NAMES.size, union.size, "GROUP_TOOL_NAMES size matches union");
  for (const name of union) {
    assert.ok(GROUP_TOOL_NAMES.has(name), `GROUP_TOOL_NAMES missing "${name}"`);
  }

  // Each tool belongs to exactly one group (no cross-group duplication).
  const seen = new Map<string, string>();
  for (const g of GROUPS) {
    for (const t of g.tools) {
      const prior = seen.get(t);
      assert.equal(prior, undefined, `tool "${t}" in both "${prior}" and "${g.name}"`);
      seen.set(t, g.name);
    }
  }

  // Runtime + LSP tool sets resolve in the catalogue.
  for (const t of [...RUNTIME_TOOLS, ...LSP_TOOLS]) {
    assert.ok(allNames.has(t), `runtime/lsp tool "${t}" not in ALL_TOOL_DEFS`);
  }
}

// ── Block 2 — findMatchesSingle ──────────────────────────────────────

{
  // Exact keyword → top match is that group with a high score.
  const tm = findMatchesSingle("tilemap", false);
  assert.ok(tm.length > 0, "tilemap → at least one match");
  assert.equal(tm[0].name, "tilemap", "tilemap → top match is the tilemap group");
  assert.ok(tm[0].score >= 3, "tilemap → exact keyword scores >= 3");

  // Tool-name-derived phrase surfaces the input_map group.
  const im = findMatchesSingle("input map action", false);
  assert.ok(
    im.some((m) => m.name === "input_map"),
    "input map action → input_map group present",
  );

  // Nonsense keyword → no matches.
  assert.deepEqual(findMatchesSingle("zzzzzznotathing", false), [], "nonsense → []");

  // matches[0] holds the maximum score.
  for (const m of im) {
    assert.ok(m.score <= im[0].score, "top score is the maximum");
  }
}

// Read-only filter contract — verify the filter's guarantee directly, without
// assuming the readOnly result is a subset of the full result (it is NOT: the
// dominant-match cutoff shifts with the smaller candidate set).
{
  const groupHasReadOnlyTool = (name: string): boolean => {
    const g = GROUPS.find((gr) => gr.name === name);
    if (!g) return false;
    return g.tools.some((t) => {
      const d = ALL_TOOL_DEFS.find((def) => def.name === t);
      return d ? isAllowedInReadOnly(d.annotations) : false;
    });
  };

  for (const kw of ["delete", "class", "animation", "save", "tilemap"]) {
    const ro = findMatchesSingle(kw, true);
    // Every group surfaced under readOnly carries at least one read-only tool.
    for (const m of ro) {
      assert.ok(groupHasReadOnlyTool(m.name), `readOnly "${kw}" surfaced mutation-only group "${m.name}"`);
    }
    // Any full-mode group lacking a read-only tool is absent from the readOnly result.
    const full = findMatchesSingle(kw, false);
    const roNames = new Set(ro.map((m) => m.name));
    for (const m of full) {
      if (!groupHasReadOnlyTool(m.name)) {
        assert.ok(!roNames.has(m.name), `mutation-only group "${m.name}" leaked into readOnly "${kw}"`);
      }
    }
  }
}

// ── Block 3 — extension registry ─────────────────────────────────────

resetLoadedGroups();
removeAllToolRefs();

{
  const cmd = (method: string, toolName: string): ExtensionCmd => ({
    method,
    toolName,
    description: `does ${method}`,
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
  });

  // Add a group → present, and a keyword surfaces it.
  addExtensionGroup("my_ext", "My extension", [cmd("ext.alpha", "ext_alpha")], ["widget", "gizmo"]);
  assert.equal(hasExtensionGroups(), true, "extension group registered");
  assert.ok(
    findMatchesSingle("widget", false).some((m) => m.name === "my_ext"),
    "extension group surfaces by keyword",
  );

  // Dedupe-by-method: adding the SAME method again must not create a second
  // command, so a single removeExtensionCommand empties (and removes) the group.
  addExtensionGroup("my_ext", "My extension", [cmd("ext.alpha", "ext_alpha")], ["widget"]);
  assert.equal(removeExtensionCommand("ext.alpha"), true, "removeExtensionCommand found the command");
  assert.equal(hasExtensionGroups(), false, "group emptied → proves only one command existed");

  // removeExtensionGroup: true on first removal, false on second.
  addExtensionGroup("g2", "G2", [cmd("g2.one", "g2_one"), cmd("g2.two", "g2_two")]);
  assert.equal(removeExtensionGroup("g2"), true, "removeExtensionGroup: first call true");
  assert.equal(removeExtensionGroup("g2"), false, "removeExtensionGroup: second call false");
  assert.equal(hasExtensionGroups(), false, "no extension groups remain");
}

resetLoadedGroups();

// ── Block 4 — activation flow via the discover_tools handler ─────────

resetLoadedGroups();
removeAllToolRefs();

{
  const handlers = new Map<string, (input: Record<string, unknown>) => Promise<{ content: { text: string }[] }>>();
  const fakeServer = {
    registerTool(name: string, _cfg: unknown, handler: (input: Record<string, unknown>) => Promise<unknown>) {
      handlers.set(name, handler as (input: Record<string, unknown>) => Promise<{ content: { text: string }[] }>);
      return {
        remove: () => {
          handlers.delete(name);
        },
        update: (_u: unknown) => {},
      };
    },
    sendToolListChanged: () => {},
  } as unknown as McpServer;

  const fakeBridge = {
    getGodotVersion: () => [4, 5] as [number, number],
    getGodotVersionString: () => "4.5.0",
    call: async () => ({ success: true }),
    callRuntime: async () => ({ success: true }),
    close: async () => {},
  } as unknown as Bridge;

  registerGroupSystem(fakeServer, fakeBridge, false);
  const discover = handlers.get("discover_tools");
  assert.ok(discover, "discover_tools handler registered");

  const parse = async (input: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const result = await discover!(input);
    return JSON.parse(result.content[0].text) as Record<string, unknown>;
  };

  // user_data tools are unversioned, so all four register at [4,5].
  const userData = GROUPS.find((g) => g.name === "user_data");
  assert.ok(userData, "user_data group exists");
  const expected = [...userData!.tools].sort();

  type GroupEntry = { name: string; status: string; tools: { name: string }[] };
  const findGroup = (out: Record<string, unknown>, name: string): GroupEntry | undefined =>
    (out.groups as GroupEntry[]).find((g) => g.name === name);

  // Activate: status activated, tool list matches, refs + handlers present.
  {
    const out = await parse({ request: "user_data" });
    const g = findGroup(out, "user_data");
    assert.ok(g, "user_data in response");
    assert.equal(g!.status, "activated", "first activation → activated");
    assert.deepEqual(g!.tools.map((t) => t.name).sort(), expected, "activated tools match the group definition");
    assert.equal(isGroupLoaded("user_data"), true, "user_data marked loaded");
    for (const t of expected) {
      assert.ok(hasToolRef(t), `tool ref present for ${t}`);
    }
    assert.ok(handlers.has(expected[0]), `handler registered for ${expected[0]}`);
  }

  // Re-activate the same group → already_loaded.
  {
    const out = await parse({ request: "user_data" });
    const g = findGroup(out, "user_data");
    assert.equal(g!.status, "already_loaded", "second activation → already_loaded");
  }

  // Reset the group → deactivated, refs + handlers gone.
  {
    const out = await parse({ reset: ["user_data"] });
    assert.ok((out.deactivated as string[]).includes("user_data"), "reset reports user_data deactivated");
    assert.equal(isGroupLoaded("user_data"), false, "user_data no longer loaded");
    assert.equal(hasToolRef(expected[0]), false, "tool ref removed after reset");
    assert.equal(handlers.has(expected[0]), false, "handler removed after reset");
  }

  // Browse without activating → available, not loaded, not registered.
  {
    const out = await parse({ request: "user_data", activate: false });
    const g = findGroup(out, "user_data");
    assert.equal(g!.status, "available", "activate:false → available");
    assert.equal(isGroupLoaded("user_data"), false, "activate:false → not loaded");
    assert.equal(handlers.has(expected[0]), false, "activate:false → not registered");
  }
}

resetLoadedGroups();
removeAllToolRefs();

console.log("All groups tests passed.");
