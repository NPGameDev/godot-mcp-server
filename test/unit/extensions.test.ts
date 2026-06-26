/**
 * Unit tests for extensions.ts — the extension subsystem facade
 * (createExtensionManager → ExtensionManager).
 *
 * Tests the PUBLIC facade ONLY (concern 091: a later internal split of
 * extensions.ts must keep these green), driving a fake server + fake bridge and
 * observing the resulting tool_refs / groups state through those modules' own
 * public API. getReadOnly is injected, so read-only cases need no env mutation.
 *
 * Blocks:
 *   1. handleExtensionsChanged — add: ungrouped (method→toolName map) + grouped.
 *   2. handleExtensionsChanged — remove via removed[].
 *   3. handleExtensionsChanged — read-only exclusion + the eligibility transitions.
 *   4. discoverExtensions — single-flight (two concurrent calls → one refresh RPC).
 */
import assert from "node:assert/strict";
import { createExtensionManager, type ExtensionManager } from "../../src/extensions.js";
import { hasToolRef, removeAllToolRefs } from "../../src/tool_refs.js";
import { resetLoadedGroups, hasExtensionGroups, findMatchesSingle, removeExtensionGroup } from "../../src/groups.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Bridge } from "../../src/types.js";

// A fake MCP server: registerTool returns a removable/updatable ref, so the real
// tool_refs module tracks each registration (registerToolWrapped calls setToolRef
// internally). Mirrors the fake in groups.test.ts / tool_helpers.test.ts.
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

// A benign fake bridge: a known version so version-gated registration passes;
// call() defaults to success. Individual blocks override call as needed.
function makeFakeBridge(over: { call?: (m: string, p?: unknown) => Promise<unknown> } = {}): Bridge {
  return {
    call: over.call ?? (async () => ({ success: true })),
    callRuntime: async () => ({ success: true }),
    close: async () => {},
    getGodotVersion: () => [4, 5] as [number, number],
    getGodotVersionString: () => "4.5.0",
  } as unknown as Bridge;
}

// Shared module state (tool_refs + loaded groups) is a per-subprocess singleton —
// reset it between blocks so each starts from a clean surface.
function reset(): void {
  removeAllToolRefs();
  resetLoadedGroups();
}

// ── Block 1 — handleExtensionsChanged: add (ungrouped + grouped) ──────

reset();
{
  const mgr: ExtensionManager = createExtensionManager({
    server: makeFakeServer(),
    bridge: makeFakeBridge(),
    getReadOnly: () => false,
  });

  // New ungrouped tool registers under the "."→"_" mapped name.
  mgr.handleExtensionsChanged({ commands: [{ method: "a.b", annotations: { readOnlyHint: true } }] });
  assert.equal(hasToolRef("a_b"), true, "ungrouped add: a.b registers as a_b");
  assert.equal(hasToolRef("a.b"), false, "the dotted method name is never the tool name");

  // New grouped tool is routed to the group registry (deferred — not an eager ref).
  mgr.handleExtensionsChanged({
    commands: [
      {
        method: "grp.tool",
        annotations: { readOnlyHint: true },
        group: { name: "mygrp", description: "My group", keywords: ["widgetkw"] },
      },
    ],
  });
  assert.equal(hasExtensionGroups(), true, "grouped add: extension group registered");
  assert.ok(
    findMatchesSingle("widgetkw", false).some((m) => m.name === "mygrp"),
    "grouped add: the group surfaces by its keyword",
  );
  assert.equal(hasToolRef("grp_tool"), false, "grouped tool is deferred (loaded via discover_tools), not eager");

  removeExtensionGroup("mygrp"); // isolate: clear the extension group before later blocks
}

// ── Block 2 — handleExtensionsChanged: remove via removed[] ───────────

reset();
{
  const mgr = createExtensionManager({ server: makeFakeServer(), bridge: makeFakeBridge(), getReadOnly: () => false });

  mgr.handleExtensionsChanged({ commands: [{ method: "ext.alpha", annotations: { readOnlyHint: true } }] });
  assert.equal(hasToolRef("ext_alpha"), true, "precondition: ext_alpha registered");

  // removed[] drops the tool; commands must still be an array (else: invalid payload, no-op).
  mgr.handleExtensionsChanged({ commands: [], removed: ["ext.alpha"] });
  assert.equal(hasToolRef("ext_alpha"), false, "removed[]: ext_alpha unregistered");
}

// ── Block 3 — read-only exclusion + eligibility transitions ───────────

reset();
{
  // getReadOnly() === true → mutating extension tools are excluded.
  const mgr = createExtensionManager({ server: makeFakeServer(), bridge: makeFakeBridge(), getReadOnly: () => true });

  // Mutating tool (no readOnlyHint) → excluded → never registered.
  mgr.handleExtensionsChanged({ commands: [{ method: "mut.tool", annotations: {} }] });
  assert.equal(hasToolRef("mut_tool"), false, "read-only: mutating extension tool excluded");

  // Read-only tool → eligible → registered.
  mgr.handleExtensionsChanged({ commands: [{ method: "ro.tool", annotations: { readOnlyHint: true } }] });
  assert.equal(hasToolRef("ro_tool"), true, "read-only: read-only extension tool registered");

  // Transition eligible → excluded: readOnlyHint dropped on the known, registered tool.
  mgr.handleExtensionsChanged({ commands: [{ method: "ro.tool", annotations: {} }] });
  assert.equal(hasToolRef("ro_tool"), false, "transition: eligible→excluded unregisters in-place");

  // Transition excluded → eligible: readOnlyHint restored on the known-but-excluded tool.
  mgr.handleExtensionsChanged({ commands: [{ method: "ro.tool", annotations: { readOnlyHint: true } }] });
  assert.equal(hasToolRef("ro_tool"), true, "transition: excluded→eligible re-registers");
}

// ── Block 4 — discoverExtensions single-flight ────────────────────────

reset();
{
  let refreshCalls = 0;
  let resolveRefresh: (v: unknown) => void = () => {};
  const refreshGate = new Promise<unknown>((res) => {
    resolveRefresh = res;
  });

  const bridge = makeFakeBridge({
    call: (method: string) => {
      if (method === "extensions.refresh") {
        refreshCalls++;
        return refreshGate; // stays pending → both discoverExtensions() calls overlap
      }
      return Promise.resolve({ success: true });
    },
  });
  const mgr = createExtensionManager({ server: makeFakeServer(), bridge, getReadOnly: () => false });

  // Two concurrent discoverExtensions() while the refresh RPC is in flight.
  const p1 = mgr.discoverExtensions();
  const p2 = mgr.discoverExtensions();
  assert.equal(refreshCalls, 1, "single-flight: two concurrent discoveries issue ONE extensions.refresh");
  assert.equal(p1, p2, "single-flight: the second concurrent call joins the in-flight promise");

  // Resolve the gate and let both settle (no double registration; the latch clears).
  resolveRefresh({ success: true, commands: [] });
  await Promise.all([p1, p2]);

  // A fresh discovery after the in-flight pass settled runs a NEW refresh RPC.
  await mgr.discoverExtensions();
  assert.equal(refreshCalls, 2, "single-flight: a post-settle discovery starts a fresh pass");
}

reset();

console.log("All extensions tests passed.");
