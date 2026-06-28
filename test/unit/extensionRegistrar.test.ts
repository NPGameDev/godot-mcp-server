/**
 * Unit tests for extension_registrar.ts — the aggregate-root registrar
 * (createExtensionRegistrar → ExtensionRegistrar): the known-extension ledger
 * (register / isRegistered / deregister), the register-one-tool recipe
 * (registerExtensionTool), and the always-on refresh tool.
 *
 * Drives a fake server + fake bridge (mirrors extensions.test.ts / groups.test.ts),
 * observing SDK registration through tool_refs (hasToolRef). The load-bearing
 * assertion is the register/track SEPARATION: registerExtensionTool registers a
 * tool WITH THE MCP SERVER (hasToolRef true) WITHOUT recording ledger membership
 * (isRegistered stays false) — callers own the ledger bookkeeping.
 *
 * Additive (concern 091 C1); the facade extensions.test.ts still covers the
 * integrated discovery + change-application behavior.
 *
 * Blocks:
 *   1. Ledger round-trip — register → isRegistered; deregister → not; unknown → false.
 *   2. registerExtensionTool read-only filter — false when excluded, true when eligible.
 *   3. register/track separation — registerExtensionTool does NOT touch the ledger.
 */
import assert from "node:assert/strict";
import { createExtensionRegistrar } from "../../src/extensions/extensionRegistrar.js";
import { hasToolRef, removeAllToolRefs } from "../../src/registration/toolRefs.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Bridge } from "../../src/shared/types.js";

// A fake MCP server: registerTool returns a removable/updatable ref, so the real
// tool_refs module tracks each registration (registerToolWrapped calls setToolRef
// internally). Mirrors the fake in extensions.test.ts / groups.test.ts.
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
// call() defaults to success (never invoked here — we only register, never call).
function makeFakeBridge(): Bridge {
  return {
    call: async () => ({ success: true }),
    callRuntime: async () => ({ success: true }),
    close: async () => {},
    getGodotVersion: () => [4, 5] as [number, number],
    getGodotVersionString: () => "4.5.0",
  } as unknown as Bridge;
}

// ── Block 1 — ledger round-trip (register / isRegistered / deregister) ─

removeAllToolRefs();
{
  const registrar = createExtensionRegistrar({
    server: makeFakeServer(),
    bridge: makeFakeBridge(),
    getReadOnly: () => false,
  });

  assert.equal(registrar.isRegistered("never_added"), false, "unknown name → not in the ledger");

  registrar.register("a_b");
  assert.equal(registrar.isRegistered("a_b"), true, "register → ledger membership true");

  registrar.deregister("a_b");
  assert.equal(registrar.isRegistered("a_b"), false, "deregister → ledger membership false");

  // register is idempotent across repeats (the closure Set dedupes).
  registrar.register("c_d");
  registrar.register("c_d");
  assert.equal(registrar.isRegistered("c_d"), true, "double register → still a single member");
  registrar.deregister("c_d");
  assert.equal(registrar.isRegistered("c_d"), false, "one deregister clears the deduped member");
}

// ── Block 2 — registerExtensionTool read-only filter ──────────────────

removeAllToolRefs();
{
  // Read-only mode: a mutating extension tool (no readOnlyHint) is excluded → false.
  const ro = createExtensionRegistrar({
    server: makeFakeServer(),
    bridge: makeFakeBridge(),
    getReadOnly: () => true,
  });

  assert.equal(
    ro.registerExtensionTool({ method: "mut.tool", annotations: {} }),
    false,
    "read-only: mutating extension tool excluded → registerExtensionTool returns false",
  );
  assert.equal(hasToolRef("mut_tool"), false, "read-only excluded tool is not registered with the server");

  // Read-only mode: a read-only-annotated extension tool is eligible → true.
  assert.equal(
    ro.registerExtensionTool({ method: "ro.tool", annotations: { readOnlyHint: true } }),
    true,
    "read-only: read-only extension tool eligible → registerExtensionTool returns true",
  );
  assert.equal(hasToolRef("ro_tool"), true, "eligible tool is registered with the server (ro.tool → ro_tool)");

  // Full mode: any extension tool is eligible → true.
  const full = createExtensionRegistrar({
    server: makeFakeServer(),
    bridge: makeFakeBridge(),
    getReadOnly: () => false,
  });
  assert.equal(
    full.registerExtensionTool({ method: "mut.two", annotations: {} }),
    true,
    "full mode: mutating extension tool eligible → registerExtensionTool returns true",
  );
  assert.equal(hasToolRef("mut_two"), true, "full mode: the tool is registered with the server");
}

// ── Block 3 — register/track separation ───────────────────────────────

removeAllToolRefs();
{
  const registrar = createExtensionRegistrar({
    server: makeFakeServer(),
    bridge: makeFakeBridge(),
    getReadOnly: () => false,
  });

  const ok = registrar.registerExtensionTool({ method: "sep.tool", annotations: { readOnlyHint: true } });
  assert.equal(ok, true, "precondition: registerExtensionTool registered the tool");
  assert.equal(hasToolRef("sep_tool"), true, "precondition: the SDK tool-ref is present");

  // The register/track separation: registering the tool did NOT record ledger
  // membership — registerExtensionTool touches the MCP server, never the ledger.
  assert.equal(
    registrar.isRegistered("sep_tool"),
    false,
    "register/track separation: registerExtensionTool does NOT add to the known-extension ledger",
  );
}

removeAllToolRefs();

console.log("All extension_registrar tests passed.");
