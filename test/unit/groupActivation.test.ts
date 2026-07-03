/**
 * Unit tests for group_activation.ts — the group-activation lifecycle carved
 * out of groups.ts. Drives the COMMAND/QUERY split + the
 * built-in-vs-extension dispatchers through a fake server + bridge, proving:
 *   1. activateGroup: registers a built-in group's tools + marks it loaded;
 *      idempotent on re-activate (already_loaded, no double-count).
 *   2. activateGroup read-only "don't waste a slot" guard: an all-mutation group
 *      under readOnly registers nothing, returns available, consumes no slot.
 *   3. reportGroupStatus is a PURE query — no mutation of loadedGroups.
 *   4. reportGroupStatusByName routes built-in → reportGroupStatus / ext →
 *      reportExtGroupStatus (pins the behavior-preservation fix: ext browse keeps
 *      its real tool list + status, instead of the empty built-in fallthrough).
 *   5. activateGroupByName routes built-in → activateGroup / unknown →
 *      activateExtGroup.
 *   6. deactivateGroups unloads built-in + ext groups (selective + true=all).
 *   7. buildDiscoverToolsDesc output shape: "name [STATE] — desc" join + the
 *      "Extensions:" suffix when extension groups exist.
 *   8. version-gated advertise surface: a below-gate (or version-unknown) editor's
 *      group summaries omit scene_close (4.5+) from browse + activate + the meta
 *      description, and the summary matches what registration installed
 *      (advertise == register), while version-agnostic tools always show.
 *
 * The fake server tracks each registration through the real tool_refs module
 * (registerToolWrapped calls setToolRef internally), so hasToolRef reflects
 * registration truth. Mirrors the fakes in groups.test.ts / extensionGroups.test.ts.
 */
import assert from "node:assert/strict";
import {
  activateGroup,
  activateGroupByName,
  reportGroupStatus,
  reportGroupStatusByName,
  deactivateGroups,
  buildDiscoverToolsDesc,
} from "../../src/groups/groupActivation.js";
import { GROUPS, allDefs } from "../../src/groups/groupCatalogue.js";
import { loadedGroups } from "../../src/groups/groupState.js";
import {
  addExtensionGroup,
  clearExtensionGroups,
  activateExtGroup,
  isExtensionGroupLoaded,
  reportExtGroupStatus,
  type ExtensionCmd,
} from "../../src/groups/extensionGroups.js";
import { isAllowedInReadOnly } from "../../src/security/profiles.js";
import { hasToolRef, removeAllToolRefs } from "../../src/registration/toolRefs.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Bridge } from "../../src/shared/types.js";

// A fake MCP server: registerTool returns a removable ref so the real tool_refs
// module tracks each registration. Mirrors the fake in extensionGroups.test.ts.
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
  return makeFakeBridgeAt([4, 5]);
}

// A fake bridge reporting a specific connected version, or undefined for "version
// unknown" — drives the version gate on the advertise surface.
function makeFakeBridgeAt(version: [number, number] | undefined): Bridge {
  return {
    call: async () => ({ success: true }),
    callRuntime: async () => ({ success: true }),
    close: async () => {},
    getGodotVersion: () => version,
    getGodotVersionString: () => (version ? `${version[0]}.${version[1]}.0` : undefined),
  } as unknown as Bridge;
}

const extCmd = (
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

// Built-in + extension state are per-subprocess singletons — reset between blocks.
function reset(): void {
  removeAllToolRefs();
  loadedGroups.clear();
  clearExtensionGroups();
}

// user_data tools are unversioned (all register at [4,5]) — a stable activation fixture.
const userData = GROUPS.find((g) => g.name === "user_data")!;
assert.ok(userData, "user_data group exists in the catalogue");
const userDataTools = [...userData.tools].sort();

// cleanup owns scene_close (godotMinVersion 4.5) alongside version-agnostic delete
// tools — the fixture for the advertise-vs-register version gate (Block 8).
const cleanup = GROUPS.find((g) => g.name === "cleanup")!;
assert.ok(cleanup, "cleanup group exists in the catalogue");
assert.ok(cleanup.tools.includes("scene_close"), "cleanup group contains the version-gated scene_close");

// ── Block 1 — activateGroup registers tools + marks loaded (+ idempotent) ──

reset();
{
  const server = makeFakeServer();
  const bridge = makeFakeBridge();

  const result = activateGroup(server, bridge, userData, false);
  assert.equal(result.status, "activated", "activateGroup → activated");
  assert.deepEqual(result.tools.map((t) => t.name).sort(), userDataTools, "activated result lists the group's tools");
  assert.equal(loadedGroups.has("user_data"), true, "activateGroup adds the group to loadedGroups");
  for (const t of userData.tools) {
    assert.ok(hasToolRef(t), `tool ref registered for ${t}`);
  }

  // Idempotent: re-activate an already-loaded group → already_loaded, no double-count.
  const again = activateGroup(server, bridge, userData, false);
  assert.equal(again.status, "already_loaded", "re-activate → already_loaded");
  assert.equal(loadedGroups.size, 1, "re-activate does not consume a second slot");
}

// ── Block 2 — read-only "don't waste a slot" guard ───────────────────

reset();
{
  const server = makeFakeServer();
  const bridge = makeFakeBridge();

  // A built-in group whose tools are ALL filtered out under read-only (every tool
  // is a mutation tool — e.g. cleanup / signals). The guard must register nothing,
  // return available, and consume NO group slot.
  const allMutation = GROUPS.find(
    (g) =>
      g.tools.length > 0 &&
      g.tools.every((t) => {
        const d = allDefs.get(t);
        return d ? !isAllowedInReadOnly(d.annotations) : true;
      }),
  );
  assert.ok(allMutation, "a fully-mutating built-in group exists");

  const result = activateGroup(server, bridge, allMutation!, true);
  assert.equal(result.status, "available", "read-only all-filtered → available");
  assert.deepEqual(result.tools, [], "read-only all-filtered → empty tool list");
  assert.equal(loadedGroups.has(allMutation!.name), false, "read-only guard consumes NO group slot");
  assert.equal(loadedGroups.size, 0, "loadedGroups unchanged by the guarded path");
  for (const t of allMutation!.tools) {
    assert.equal(hasToolRef(t), false, `no tool ref registered for filtered ${t}`);
  }
}

// ── Block 3 — reportGroupStatus is a pure query ──────────────────────

reset();
{
  const bridge = makeFakeBridge();

  // Unloaded built-in → available, lists tools, NO mutation.
  const q = reportGroupStatus(bridge, "user_data", false);
  assert.equal(q.status, "available", "report on an unloaded group → available");
  assert.deepEqual(q.tools.map((t) => t.name).sort(), userDataTools, "report lists the group's tools");
  assert.equal(loadedGroups.has("user_data"), false, "report did NOT load the group");
  assert.equal(loadedGroups.size, 0, "report mutates nothing");

  // After a real activation, report reflects already_loaded — still pure.
  activateGroup(makeFakeServer(), bridge, userData, false);
  const sizeAfterActivate = loadedGroups.size;
  const loaded = reportGroupStatus(bridge, "user_data", false);
  assert.equal(loaded.status, "already_loaded", "report on a loaded group → already_loaded");
  assert.equal(loadedGroups.size, sizeAfterActivate, "report on a loaded group still mutates nothing");

  // Unknown (non-built-in) name → available with empty tools (the fallthrough).
  const unknown = reportGroupStatus(bridge, "definitely_not_a_group", false);
  assert.equal(unknown.status, "available", "unknown name → available");
  assert.deepEqual(unknown.tools, [], "unknown name → empty tools");
}

// ── Block 4 — reportGroupStatusByName built-in/ext dispatch (the fix) ──

reset();
{
  const server = makeFakeServer();
  const bridge = makeFakeBridge();

  // Register + activate an extension group so it carries a real tool list + a
  // loaded status — the exact state the empty built-in fallthrough would drop.
  addExtensionGroup("ext_demo", "Ext demo", [extCmd("ext.one", "ext_one"), extCmd("ext.two", "ext_two")], ["demokw"]);
  activateExtGroup(server, bridge, "ext_demo");
  assert.equal(isExtensionGroupLoaded("ext_demo"), true, "ext_demo activated");

  // Built-in name → routes to reportGroupStatus (real built-in tool list).
  const builtin = reportGroupStatusByName(bridge, "user_data", false);
  assert.deepEqual(builtin, reportGroupStatus(bridge, "user_data", false), "byName built-in === reportGroupStatus");
  assert.deepEqual(builtin.tools.map((t) => t.name).sort(), userDataTools, "byName built-in lists the built-in tools");

  // Extension name → routes to reportExtGroupStatus: real tools + already_loaded.
  // (The bug this pins: routing ext browse to the built-in reportGroupStatus
  // returns empty tools + loses the already_loaded status.)
  const ext = reportGroupStatusByName(bridge, "ext_demo", false);
  assert.equal(ext.status, "already_loaded", "byName ext keeps the ext already_loaded status");
  assert.deepEqual(
    ext.tools.map((t) => t.name).sort(),
    ["ext_one", "ext_two"],
    "byName ext returns the ext group's real tool list (NOT empty)",
  );
  assert.deepEqual(ext, reportExtGroupStatus("ext_demo", false), "byName ext === reportExtGroupStatus(readOnly)");
}

// ── Block 5 — activateGroupByName built-in/ext dispatch ──────────────

reset();
{
  const server = makeFakeServer();
  const bridge = makeFakeBridge();

  // Built-in name → activates the built-in group (loadedGroups + refs updated).
  const builtin = activateGroupByName(server, bridge, "user_data", false);
  assert.equal(builtin.status, "activated", "byName built-in → activated");
  assert.equal(loadedGroups.has("user_data"), true, "byName built-in updates loadedGroups");
  assert.equal(isExtensionGroupLoaded("user_data"), false, "built-in is not tracked as an ext group");

  // Unknown name with a registered ext group → delegates to activateExtGroup.
  addExtensionGroup("ext_demo", "Ext demo", [extCmd("ext.one", "ext_one")], ["demokw"]);
  const ext = activateGroupByName(server, bridge, "ext_demo", false);
  assert.equal(ext.status, "activated", "byName unknown(ext) → activated via activateExtGroup");
  assert.equal(isExtensionGroupLoaded("ext_demo"), true, "ext group loaded in the ext registry");
  assert.equal(loadedGroups.has("ext_demo"), false, "ext group is NOT added to built-in loadedGroups");
  assert.ok(hasToolRef("ext_one"), "ext tool registered");

  // Truly-unknown name → activateExtGroup returns available ("Unknown group").
  const nope = activateGroupByName(server, bridge, "no_such_group_xyz", false);
  assert.equal(nope.status, "available", "byName truly-unknown → available");
}

// ── Block 6 — deactivateGroups (built-in + ext; true = deactivate-all) ──

reset();
{
  const server = makeFakeServer();
  const bridge = makeFakeBridge();

  activateGroupByName(server, bridge, "user_data", false);
  addExtensionGroup("ext_demo", "Ext demo", [extCmd("ext.one", "ext_one")], ["demokw"]);
  activateExtGroup(server, bridge, "ext_demo");
  assert.equal(loadedGroups.has("user_data"), true, "built-in loaded");
  assert.equal(isExtensionGroupLoaded("ext_demo"), true, "ext loaded");

  // Selective deactivate of the built-in only — ext stays loaded.
  const selective = deactivateGroups(["user_data"], false);
  assert.deepEqual(selective, ["user_data"], "selective deactivate returns the built-in");
  assert.equal(loadedGroups.has("user_data"), false, "built-in unloaded");
  for (const t of userData.tools) {
    assert.equal(hasToolRef(t), false, `built-in tool ${t} unregistered`);
  }
  assert.equal(isExtensionGroupLoaded("ext_demo"), true, "ext still loaded after selective deactivate");

  // true = deactivate ALL — clears the remaining ext group + its tools.
  const all = deactivateGroups(true, false);
  assert.deepEqual(all, ["ext_demo"], "deactivate-all clears the remaining ext group");
  assert.equal(isExtensionGroupLoaded("ext_demo"), false, "ext unloaded after deactivate-all");
  assert.equal(hasToolRef("ext_one"), false, "ext tool unregistered after deactivate-all");
}

// ── Block 7 — buildDiscoverToolsDesc output shape ────────────────────

reset();
{
  const bridge = makeFakeBridge();
  const sig = GROUPS.find((g) => g.name === "signals")!;
  assert.ok(sig, "signals group exists");

  // No ext groups: built-in entries as "name [available] — desc"; no Extensions suffix.
  const desc = buildDiscoverToolsDesc(bridge, false);
  assert.ok(desc.startsWith("Find and activate tool groups"), "desc opens with the intro line");
  assert.ok(desc.includes("Groups: "), "desc carries the Groups: section");
  assert.ok(
    desc.includes(`signals [available] — ${sig.description}`),
    "built-in entry renders as 'name [available] — desc'",
  );
  assert.ok(!desc.includes("Extensions:"), "no Extensions suffix when no ext groups exist");

  // Activating a built-in flips its tag to [LOADED].
  activateGroup(makeFakeServer(), bridge, sig, false);
  assert.ok(
    buildDiscoverToolsDesc(bridge, false).includes("signals [LOADED] —"),
    "an activated group renders [LOADED]",
  );

  // A registered ext group adds the Extensions suffix as "name [available] — desc".
  addExtensionGroup("ext_demo", "Ext demo desc", [extCmd("ext.one", "ext_one")], ["demokw"]);
  const withExt = buildDiscoverToolsDesc(bridge, false);
  assert.ok(withExt.includes(". Extensions: "), "ext groups add the Extensions: suffix");
  assert.ok(withExt.includes("ext_demo [available] — Ext demo desc"), "ext entry renders as 'name [available] — desc'");
}

// ── Block 8 — version-gated advertise surface (scene_close @ 4.5+) ────
// discover_tools' group summaries must not advertise a tool the connected editor
// cannot serve: the advertise surface must match the register surface. scene_close
// is gated 4.5+; every OTHER cleanup tool is version-agnostic, so the gate filters
// exactly the one tool and never the whole group. Version-unknown mirrors
// registration's conservative skip (treat gated as unavailable).

for (const { version, label, gated } of [
  { version: [4, 4] as [number, number] | undefined, label: "4.4", gated: false },
  { version: [4, 5] as [number, number] | undefined, label: "4.5", gated: true },
  { version: [4, 6] as [number, number] | undefined, label: "4.6", gated: true },
  { version: undefined as [number, number] | undefined, label: "unknown", gated: false },
]) {
  reset();
  const bridge = makeFakeBridgeAt(version);
  const otherTool = cleanup.tools.find((t) => t !== "scene_close")!;

  // Browse (activate:false) — pure query, both the direct and by-name dispatch.
  const browse = reportGroupStatus(bridge, "cleanup", false);
  assert.equal(
    browse.tools.some((t) => t.name === "scene_close"),
    gated,
    `[${label}] browse summary ${gated ? "offers" : "omits"} scene_close`,
  );
  assert.ok(
    browse.tools.some((t) => t.name === otherTool),
    `[${label}] browse keeps the version-agnostic ${otherTool}`,
  );
  assert.deepEqual(
    reportGroupStatusByName(bridge, "cleanup", false),
    browse,
    `[${label}] byName browse === reportGroupStatus`,
  );

  // Activate — the activated summary is the registerGroupTools return, and it must
  // agree with what was actually registered (hasToolRef): advertise == register.
  const activated = activateGroup(makeFakeServer(), bridge, cleanup, false);
  assert.equal(
    activated.tools.some((t) => t.name === "scene_close"),
    gated,
    `[${label}] activate summary ${gated ? "lists" : "omits"} scene_close`,
  );
  assert.equal(
    hasToolRef("scene_close"),
    gated,
    `[${label}] scene_close is registered iff serveable (advertise matches register)`,
  );
  assert.ok(hasToolRef(otherTool), `[${label}] the version-agnostic ${otherTool} is always registered`);

  // Meta description — cleanup has version-agnostic tools, so it is NEVER dropped;
  // the empty-after-filter drop only removes an all-gated group (none exist today).
  assert.ok(
    buildDiscoverToolsDesc(bridge, false).includes("cleanup ["),
    `[${label}] cleanup stays in the meta description (has version-agnostic tools)`,
  );
}

reset();

console.log("All group_activation tests passed.");
