/**
 * Unit tests for extensionCollision.ts — the extension/built-in name-collision
 * guard, plus its integration into the ungrouped (registrar) and grouped
 * (extension-group activation) registration paths.
 *
 * The load-bearing guarantee: an extension can never take over a built-in's name
 * (nor a name another extension already registered). A clash is skipped with a
 * loud stderr warning, never a crash, and the incumbent survives untouched.
 *
 * Blocks:
 *   1. isBuiltinToolName — catalogue names + meta tools are built-in; others aren't.
 *   2. extensionNameCollides — built-in name collides + warns; a free name doesn't.
 *   3. extensionNameCollides — an already-registered name collides + warns.
 *   4. registrar (ungrouped) — a built-in-named extension tool is skipped, not claimed.
 *   5. registrar (ungrouped) — first-writer-wins: a second extension can't take the name.
 *   6. grouped activation — a built-in-named grouped tool is skipped; the free one loads.
 */
import assert from "node:assert/strict";
import { ALL_TOOL_NAMES, isBuiltinToolName } from "../../src/registration/catalogue.js";
import { extensionNameCollides } from "../../src/registration/extensionCollision.js";
import { createExtensionRegistrar } from "../../src/extensions/extensionRegistrar.js";
import { hasToolRef, removeAllToolRefs, setToolRef } from "../../src/registration/toolRefs.js";
import { addExtensionGroup, activateExtGroup, clearExtensionGroups } from "../../src/groups/extensionGroups.js";
import { captureStderr } from "./helpers.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Bridge } from "../../src/shared/types.js";

// A fake MCP server: registerTool returns a removable/updatable ref, so the real
// tool_refs module tracks each registration. Mirrors the fakes in the sibling
// extension tests.
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

// A real built-in tool name, taken from the catalogue (not hard-coded so the test
// survives catalogue churn). Both halves of the collision check key off this name.
const aBuiltin = [...ALL_TOOL_NAMES][0];

// ── Block 1 — isBuiltinToolName ───────────────────────────────────────

{
  assert.ok(aBuiltin, "the catalogue is non-empty");
  assert.equal(isBuiltinToolName(aBuiltin), true, "a catalogue tool name is a built-in name");
  assert.equal(isBuiltinToolName("discover_tools"), true, "the discover_tools meta tool is a built-in name");
  assert.equal(isBuiltinToolName("extensions_refresh"), true, "the extensions_refresh meta tool is a built-in name");
  assert.equal(isBuiltinToolName("not_a_real_tool_xyz_123"), false, "an unused name is not a built-in name");
}

// ── Block 2 — extensionNameCollides: built-in name vs a free name ─────

removeAllToolRefs();
{
  const cap = captureStderr();
  const collidesBuiltin = extensionNameCollides(aBuiltin);
  const freeName = extensionNameCollides("totally_free_ext_name_abc");
  cap.restore();

  assert.equal(collidesBuiltin, true, "an extension name equal to a built-in collides");
  assert.equal(freeName, false, "a free name does not collide");

  const warnings = cap.output();
  assert.ok(warnings.includes(`extension tool '${aBuiltin}' collides`), "the built-in collision warns loudly");
  assert.ok(warnings.includes("skipped"), "the warning states the tool was skipped");
  assert.ok(!warnings.includes("totally_free_ext_name_abc"), "a free name produces no warning");
}

// ── Block 3 — extensionNameCollides: an already-registered name ───────

removeAllToolRefs();
{
  // Simulate a name already held by another tool (built-in or earlier extension).
  setToolRef("already_registered_tool", { remove() {}, update() {} });

  const cap = captureStderr();
  const collides = extensionNameCollides("already_registered_tool");
  cap.restore();

  assert.equal(collides, true, "a name already registered collides (first-writer-wins)");
  assert.ok(cap.output().includes("already_registered_tool"), "the already-registered collision warns");
}

// ── Block 4 — registrar (ungrouped): a built-in name cannot be claimed ─

removeAllToolRefs();
{
  const registrar = createExtensionRegistrar({
    server: makeFakeServer(),
    bridge: makeFakeBridge(),
    getReadOnly: () => false,
  });

  // toolNameFromMethod leaves an already-underscored name unchanged, so a method
  // equal to a built-in's tool name maps straight onto it.
  const cap = captureStderr();
  const claimed = registrar.registerExtensionTool({ method: aBuiltin, annotations: { readOnlyHint: true } });
  cap.restore();

  assert.equal(claimed, false, "registerExtensionTool refuses a built-in name");
  assert.equal(hasToolRef(aBuiltin), false, "the extension did NOT claim the built-in's name");
  assert.ok(cap.output().includes(aBuiltin), "the skip is warned");

  // A free extension name still registers normally (no false positives).
  assert.equal(
    registrar.registerExtensionTool({ method: "fresh.ext.tool", annotations: { readOnlyHint: true } }),
    true,
    "a non-colliding extension tool still registers",
  );
  assert.equal(hasToolRef("fresh_ext_tool"), true, "the free extension tool is registered");
}

// ── Block 5 — registrar (ungrouped): first-writer-wins, incumbent intact ─

removeAllToolRefs();
{
  const extServerCalls = new Map<string, number>();
  const extServer = {
    registerTool(name: string) {
      extServerCalls.set(name, (extServerCalls.get(name) ?? 0) + 1);
      return { remove: () => {}, update: (_u: unknown) => {} };
    },
    sendToolListChanged: () => {},
  } as unknown as McpServer;

  // A non-built-in name an EARLIER extension already holds (its ref must survive).
  let incumbentRemoved = false;
  setToolRef("incumbent_only", {
    remove() {
      incumbentRemoved = true;
    },
    update() {},
  });

  const registrar = createExtensionRegistrar({ server: extServer, bridge: makeFakeBridge(), getReadOnly: () => false });

  const cap = captureStderr();
  const claimed = registrar.registerExtensionTool({ method: "incumbent.only", annotations: { readOnlyHint: true } });
  cap.restore();

  assert.equal(claimed, false, "a second extension cannot claim a name a first extension holds");
  assert.equal(extServerCalls.get("incumbent_only") ?? 0, 0, "the second extension never reached server.registerTool");
  assert.equal(incumbentRemoved, false, "the first extension's tool survives untouched (first-writer-wins)");
  assert.ok(cap.output().includes("incumbent_only"), "the cross-extension collision is warned");
}

// ── Block 6 — grouped activation skips a built-in-named tool ──────────

removeAllToolRefs();
clearExtensionGroups();
{
  // A deferred group carrying one built-in-named tool + one free tool. Even if a
  // colliding tool reaches the group map, activation must refuse only that one.
  addExtensionGroup("collide_grp", "Collision group", [
    {
      method: aBuiltin,
      toolName: aBuiltin,
      description: "shadow",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    {
      method: "free.grp.tool",
      toolName: "free_grp_tool",
      description: "ok",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
  ]);

  const cap = captureStderr();
  activateExtGroup(makeFakeServer(), makeFakeBridge(), "collide_grp");
  cap.restore();

  assert.equal(hasToolRef(aBuiltin), false, "grouped activation skips the built-in-colliding tool");
  assert.equal(hasToolRef("free_grp_tool"), true, "grouped activation still registers the free tool");
  assert.ok(cap.output().includes(aBuiltin), "the grouped collision is warned");

  clearExtensionGroups();
}

removeAllToolRefs();
clearExtensionGroups();

console.log("All extensionCollision tests passed.");
