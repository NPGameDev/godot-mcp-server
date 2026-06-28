/**
 * Integration test for registerGroupSystem — drives the composed group system
 * end-to-end through the groups.js barrel and the parsed discover_tools JSON.
 *
 * registerGroupSystem installs the discover_tools handler on a fake MCP server +
 * bridge; the activation internals are reached ONLY through that handler, never
 * the unit functions directly. The round-trip it pins, on the user_data group:
 *   - activate → status activated, tools registered, refs + handlers present;
 *   - re-activate the same group → already_loaded;
 *   - reset → deactivated, refs + handlers removed;
 *   - browse (activate:false) → available, nothing registered.
 *
 * The units composed here (static catalogue, keyword match, extension registry,
 * activation lifecycle) are covered directly by their own per-module tests; this
 * file pins only the composed barrel path.
 */
import assert from "node:assert/strict";
import { GROUPS, resetLoadedGroups, registerGroupSystem } from "../../src/groups/groups.js";
import { isGroupLoaded } from "../../src/groups/groupState.js";
import { hasToolRef, removeAllToolRefs } from "../../src/registration/toolRefs.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Bridge } from "../../src/shared/types.js";

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
