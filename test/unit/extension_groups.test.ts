/**
 * Unit tests for extension_groups.ts — the dynamic extension-group registry
 * carved out of groups.ts (concern 077, C1). Drives the private maps through
 * the public mutators + accessors (the maps never leave the module), proving:
 *   1. addExtensionGroup: new-group registration, dedupe-by-method, "; " desc
 *      merge, no-dup keyword merge.
 *   2. removeExtensionCommand: removes one command + auto-removes the now-empty
 *      group and its loaded flag.
 *   3. removeExtensionGroup: unregisters every tool via a mock server.
 *   4. clearExtensionGroups: empties both maps.
 *   5. The accessors return private-map truth across a sequence of mutations
 *      (activate / re-activate / report-is-pure-query / deactivate).
 *   6. reportExtGroupStatus applies the read-only tool-filter when readOnly=true
 *      (the 081 split preserves the fused query's behavior); browse is unfiltered.
 */
import assert from "node:assert/strict";
import {
  addExtensionGroup,
  removeExtensionCommand,
  removeExtensionGroup,
  hasExtensionGroups,
  clearExtensionGroups,
  deactivateExtensionGroup,
  extensionGroupEntries,
  getExtensionGroup,
  isExtensionGroupLoaded,
  loadedExtensionGroupCount,
  loadedExtensionGroupNames,
  activateExtGroup,
  reportExtGroupStatus,
  registerExtGroupTools,
  type ExtensionCmd,
} from "../../src/groups/extensionGroups.js";
import { hasToolRef, removeAllToolRefs } from "../../src/registration/toolRefs.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Bridge } from "../../src/shared/types.js";

// A fake MCP server: registerTool returns a removable/updatable ref, so the real
// tool_refs module tracks each registration (registerToolWrapped calls setToolRef
// internally). Mirrors the fake in groups.test.ts / extensions.test.ts.
function makeFakeServer(): McpServer {
  const handlers = new Map<string, unknown>();
  return {
    registerTool(name: string, _cfg: unknown, handler: unknown) {
      handlers.set(name, handler);
      return {
        remove: () => {
          handlers.delete(name);
        },
        update: (_u: unknown) => {},
      };
    },
    sendToolListChanged: () => {},
  } as unknown as McpServer;
}

// A benign fake bridge: a known version so version-gated registration passes.
function makeFakeBridge(): Bridge {
  return {
    call: async () => ({ success: true }),
    callRuntime: async () => ({ success: true }),
    close: async () => {},
    getGodotVersion: () => [4, 5] as [number, number],
    getGodotVersionString: () => "4.5.0",
  } as unknown as Bridge;
}

const cmd = (
  method: string,
  toolName: string,
  annotations: Record<string, boolean> = { readOnlyHint: true },
): ExtensionCmd => ({
  method,
  toolName,
  description: `does ${method}`,
  inputSchema: { type: "object", properties: {} },
  annotations,
});

// Both registries are per-subprocess singletons — reset between blocks.
function reset(): void {
  removeAllToolRefs();
  clearExtensionGroups();
}

// ── Block 1 — addExtensionGroup: register / dedupe / merge ────────────

reset();
{
  // New group registers with its commands + keywords.
  addExtensionGroup("alpha", "Alpha group", [cmd("a.one", "a_one")], ["widget"]);
  assert.equal(hasExtensionGroups(), true, "new group registered");
  const g = getExtensionGroup("alpha");
  assert.ok(g, "getExtensionGroup returns the new group");
  assert.equal(g!.commands.length, 1, "one command stored");
  assert.deepEqual(g!.keywords, ["widget"], "keywords stored");

  // Dedupe-by-method: re-adding the SAME method is a no-op (no second command).
  addExtensionGroup("alpha", "", [cmd("a.one", "a_one")]);
  assert.equal(getExtensionGroup("alpha")!.commands.length, 1, "dedupe-by-method: re-add same method → no new command");

  // A genuinely new method appends.
  addExtensionGroup("alpha", "", [cmd("a.two", "a_two")]);
  assert.equal(getExtensionGroup("alpha")!.commands.length, 2, "a distinct method appends");

  // Description merges with "; " when non-empty and different.
  addExtensionGroup("alpha", "Extra desc", []);
  assert.equal(getExtensionGroup("alpha")!.description, "Alpha group; Extra desc", "description merges with '; '");

  // Keywords merge without duplicates ("widget" already present → only "gizmo" added).
  addExtensionGroup("alpha", "", [], ["widget", "gizmo"]);
  assert.deepEqual(getExtensionGroup("alpha")!.keywords, ["widget", "gizmo"], "keywords merge, no duplicate");
}

// ── Block 2 — removeExtensionCommand: empty-group auto-cleanup ─────────

reset();
{
  addExtensionGroup("beta", "Beta", [cmd("b.one", "b_one"), cmd("b.two", "b_two")]);
  // Activate so the group carries a loaded flag — proves auto-removal clears it.
  activateExtGroup(makeFakeServer(), makeFakeBridge(), "beta");
  assert.equal(isExtensionGroupLoaded("beta"), true, "beta loaded after activation");

  // Remove one of two commands → group survives (one command remains, still loaded).
  assert.equal(removeExtensionCommand("b.one"), true, "removeExtensionCommand finds b.one");
  assert.equal(getExtensionGroup("beta")!.commands.length, 1, "one command remains");
  assert.equal(isExtensionGroupLoaded("beta"), true, "group still loaded (commands remain)");

  // Remove the last command → group auto-removed AND its loaded flag cleared.
  assert.equal(removeExtensionCommand("b.two"), true, "removeExtensionCommand finds b.two");
  assert.equal(getExtensionGroup("beta"), undefined, "now-empty group auto-removed");
  assert.equal(isExtensionGroupLoaded("beta"), false, "loaded flag cleared on auto-remove");
  assert.equal(hasExtensionGroups(), false, "no extension groups remain");

  // Unknown method → false.
  assert.equal(removeExtensionCommand("nope.x"), false, "unknown method → false");
}

// ── Block 3 — registerExtGroupTools + removeExtensionGroup ────────────

reset();
{
  const server = makeFakeServer();
  const bridge = makeFakeBridge();
  addExtensionGroup("gamma", "Gamma", [cmd("g.one", "g_one"), cmd("g.two", "g_two")]);

  const registered = registerExtGroupTools(server, bridge, getExtensionGroup("gamma")!);
  assert.deepEqual([...registered].sort(), ["g_one", "g_two"], "registerExtGroupTools returns both tool names");
  assert.equal(hasToolRef("g_one"), true, "g_one registered");
  assert.equal(hasToolRef("g_two"), true, "g_two registered");

  // removeExtensionGroup unregisters every tool + returns true; second call false.
  assert.equal(removeExtensionGroup("gamma"), true, "removeExtensionGroup: first call true");
  assert.equal(hasToolRef("g_one"), false, "g_one unregistered after removeExtensionGroup");
  assert.equal(hasToolRef("g_two"), false, "g_two unregistered after removeExtensionGroup");
  assert.equal(removeExtensionGroup("gamma"), false, "removeExtensionGroup: second call false");
}

// ── Block 4 — clearExtensionGroups empties both maps ─────────────────

reset();
{
  addExtensionGroup("d1", "D1", [cmd("d1.a", "d1_a")]);
  addExtensionGroup("d2", "D2", [cmd("d2.a", "d2_a")]);
  activateExtGroup(makeFakeServer(), makeFakeBridge(), "d1");
  assert.equal(hasExtensionGroups(), true, "groups present pre-clear");
  assert.equal(loadedExtensionGroupCount(), 1, "one loaded pre-clear");

  clearExtensionGroups();
  assert.equal(hasExtensionGroups(), false, "extensionGroups empty after clear");
  assert.equal(loadedExtensionGroupCount(), 0, "loadedExtensionGroups empty after clear");
  assert.deepEqual([...extensionGroupEntries()], [], "no entries after clear");
}

// ── Block 5 — accessors mirror private-map truth across mutations ─────

reset();
{
  const server = makeFakeServer();
  const bridge = makeFakeBridge();

  addExtensionGroup("e1", "E1 group", [cmd("e1.a", "e1_a")], ["alpha"]);
  addExtensionGroup("e2", "E2 group", [cmd("e2.a", "e2_a")], ["beta"]);

  // Pre-activation: groups exist, none loaded.
  assert.equal(loadedExtensionGroupCount(), 0, "nothing loaded yet");
  assert.deepEqual(loadedExtensionGroupNames(), [], "no loaded names yet");
  assert.equal(isExtensionGroupLoaded("e1"), false, "e1 not loaded yet");

  // extensionGroupEntries mirrors insertion order + carries the def value.
  const entries = [...extensionGroupEntries()];
  assert.deepEqual(
    entries.map(([n]) => n),
    ["e1", "e2"],
    "entries enumerate both names in insertion order",
  );
  assert.equal(entries[0][1].description, "E1 group", "entry value is the live def");

  // reportExtGroupStatus is a PURE query — status only, no load.
  const q = reportExtGroupStatus("e1");
  assert.equal(q.status, "available", "report → available before activation");
  assert.equal(isExtensionGroupLoaded("e1"), false, "report did NOT load e1");

  // activateExtGroup loads e1 → the loaded accessors reflect it.
  assert.equal(activateExtGroup(server, bridge, "e1").status, "activated", "activate → activated");
  assert.equal(isExtensionGroupLoaded("e1"), true, "e1 now loaded");
  assert.equal(loadedExtensionGroupCount(), 1, "count reflects one loaded");
  assert.deepEqual(loadedExtensionGroupNames(), ["e1"], "names reflect e1");

  // Re-activate is idempotent → already_loaded, count unchanged.
  assert.equal(activateExtGroup(server, bridge, "e1").status, "already_loaded", "re-activate → already_loaded");
  assert.equal(loadedExtensionGroupCount(), 1, "count unchanged on re-activate");

  // getExtensionGroup returns the live def; unknown → undefined.
  assert.equal(getExtensionGroup("e1")!.commands[0].toolName, "e1_a", "getExtensionGroup returns the live def");
  assert.equal(getExtensionGroup("nope"), undefined, "unknown group → undefined");

  // deactivateExtensionGroup: false for an unloaded group, true for a loaded one.
  assert.equal(deactivateExtensionGroup("e2"), false, "deactivate an unloaded group → false");
  assert.equal(deactivateExtensionGroup("e1"), true, "deactivate a loaded group → true");
  assert.equal(isExtensionGroupLoaded("e1"), false, "e1 no longer loaded");
  assert.equal(loadedExtensionGroupCount(), 0, "count back to zero");
  // Deactivation only UNLOADS — the group def itself remains registered.
  assert.ok(getExtensionGroup("e1"), "deactivate keeps the group registered (only unloads)");
}

// ── Block 6 — reportExtGroupStatus read-only filter (081 split preserves the fused query's filter) ─────

reset();
{
  // A group with one read-only tool + one mutation tool (readOnlyHint:false → excluded in read-only).
  addExtensionGroup("ro_grp", "RO group", [cmd("ro.a", "ro_a"), cmd("ro.b", "ro_b", { readOnlyHint: false })]);

  // readOnly=true → only the read-only-allowed tool (mirrors the built-in reportGroupStatus filter).
  assert.deepEqual(
    reportExtGroupStatus("ro_grp", true).tools,
    [{ name: "ro_a" }],
    "read-only query filters out the mutation tool",
  );
  // Browse (readOnly omitted) + explicit false → unfiltered, both tools in insertion order.
  assert.deepEqual(
    reportExtGroupStatus("ro_grp").tools.map((t) => t.name),
    ["ro_a", "ro_b"],
    "browse query (readOnly omitted) is unfiltered",
  );
  assert.deepEqual(
    reportExtGroupStatus("ro_grp", false).tools.map((t) => t.name),
    ["ro_a", "ro_b"],
    "explicit readOnly=false is unfiltered",
  );
}

reset();

console.log("All extension_groups tests passed.");
