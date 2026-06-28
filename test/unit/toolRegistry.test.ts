/**
 * Unit tests for toolRegistry.ts — the tool-registration wrappers:
 * registerToolWrapped (path-guard dispatch wiring + version-gate filtering),
 * batchToolRegistration (notification collapse), and versionSupportText.
 */

import assert from "node:assert/strict";
import { registerToolWrapped, batchToolRegistration, versionSupportText } from "../../src/registration/toolRegistry.js";
import { PROJECT_FILE_PATH } from "../../src/security/pathGuard.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Bridge, PathGuard, ToolTextResult } from "../../src/shared/types.js";

// ── path-guard dispatch wiring (registerToolWrapped) ─────────────────
// Shields the new spec: a tool that declares pathParams fast-fails an
// out-of-bounds path with PATH_DENIED *before* the handler/bridge runs, and a
// tool that declares none is never filtered.

/** Register a tool through registerToolWrapped and capture its wrapped handler. */
function captureWrapped(name: string, pathParams?: readonly PathGuard[]) {
  let calls = 0;
  let captured: ((input: Record<string, unknown>, extra?: { signal?: AbortSignal }) => Promise<ToolTextResult>) | null =
    null;
  const fakeServer = {
    registerTool: (_n: string, _c: unknown, h: NonNullable<typeof captured>) => {
      captured = h;
      return {};
    },
    sendToolListChanged: () => {},
  } as unknown as McpServer;
  const fakeBridge = { getGodotVersion: () => null } as unknown as Bridge;
  const handler = async (): Promise<ToolTextResult> => {
    calls++;
    return { content: [{ type: "text", text: "ok" }] };
  };
  registerToolWrapped(fakeServer, fakeBridge, name, { description: "t", inputSchema: {} }, handler, { pathParams });
  return { invoke: (input: Record<string, unknown>) => captured!(input), calls: () => calls };
}

// Declared project guard: bad path → PATH_DENIED, handler NOT reached (fast-fail).
{
  const t = captureWrapped("pg_wire_project", [PROJECT_FILE_PATH]);
  const bad = await t.invoke({ file_path: "res://../escape.gd" });
  assert.equal(bad.isError, true);
  assert.equal(JSON.parse(bad.content[0].text).code, "PATH_DENIED");
  assert.equal(t.calls(), 0);
  // Good path → handler reached.
  const ok = await t.invoke({ file_path: "res://ok.gd" });
  assert.equal(ok.isError, undefined);
  assert.equal(t.calls(), 1);
  // Absent optional param → skip → handler reached.
  await t.invoke({});
  assert.equal(t.calls(), 2);
}

// Undeclared tool: an out-of-bounds path passes straight through (no filtering).
{
  const t = captureWrapped("pg_wire_none");
  await t.invoke({ file_path: "res://../escape.gd" });
  assert.equal(t.calls(), 1);
}

// User guard: a res:// path to a user:// param is rejected.
{
  const t = captureWrapped("pg_wire_user", [{ param: "path", guard: "user" }]);
  const bad = await t.invoke({ path: "res://nope.gd" });
  assert.equal(JSON.parse(bad.content[0].text).code, "PATH_DENIED");
  assert.equal(t.calls(), 0);
  const ok = await t.invoke({ path: "user://saves/slot1.json" });
  assert.equal(ok.isError, undefined);
  assert.equal(t.calls(), 1);
}

// ── batchToolRegistration — notification collapse (config-reload invariant) ──
// The config-reload path wraps removeAllTools()+registerModules()+registerGroups()
// in batchToolRegistration so a live reload emits ONE tools/list_changed, not a
// burst. The real MCP SDK funnels BOTH registerTool and ref.remove() (remove =
// update({name:null})) through server.sendToolListChanged(), so suppressing that
// method during the batch collapses the whole remove+rebuild into a single event.
// This fake mirrors that routing: registerTool and the ref's remove() each invoke
// server.sendToolListChanged() — read dynamically, so the batch's no-op swap hides
// them, exactly as the SDK's instance method does.

function makeCountingServer() {
  let count = 0;
  const fake = {
    sendToolListChanged() {
      count++;
    },
    registerTool(_name: string, _config: unknown, _handler: unknown) {
      fake.sendToolListChanged(); // SDK emits on registration
      return {
        remove() {
          fake.sendToolListChanged(); // SDK emits on removal (update({name:null}))
        },
      };
    },
  };
  return { fake, server: fake as unknown as McpServer, count: () => count };
}

// Drive an identical register-three-then-remove-three burst against a counting
// server, returning the resulting notification count.
function registerThenRemoveBurst(fake: ReturnType<typeof makeCountingServer>["fake"]): void {
  const refs = [
    fake.registerTool("alpha", {}, async () => {}),
    fake.registerTool("beta", {}, async () => {}),
    fake.registerTool("gamma", {}, async () => {}),
  ];
  for (const ref of refs) ref.remove();
}

// Batched: the whole burst collapses to exactly ONE notification.
{
  const { fake, server, count } = makeCountingServer();
  batchToolRegistration(server, () => {
    registerThenRemoveBurst(fake);
  });
  assert.equal(count(), 1, "batched register+remove burst must emit exactly one notification");
}

// Control: the SAME ops without the batch wrapper emit one notification PER op (>1).
{
  const { fake, count } = makeCountingServer();
  registerThenRemoveBurst(fake);
  assert.ok(count() > 1, "unbatched burst must emit more than one notification");
  assert.equal(count(), 6, "unbatched burst emits one per op (3 register + 3 remove)");
}

// ── version-gate registration recovery ───────────────────────────────
// registerToolWrapped filters version-gated tools at registration time against
// bridge.getGodotVersion(): unknown → fail-closed (skip), known-incompatible →
// skip, known-compatible → register. The startup reconcile (index.ts) leans on
// exactly this gate — when the editor reports its version later, a re-registration
// pass lands (or correctly skips) each version-gated tool. These cases shield the
// gate's three outcomes against a fake bridge whose getGodotVersion() is pinned.

/** Register one version-gated tool and report whether it reached server.registerTool. */
function gateRegisters(
  connected: [number, number] | null,
  verOpts: { godotMinVersion?: string; godotMaxVersion?: string },
): boolean {
  let registered = false;
  const fakeServer = {
    registerTool: () => {
      registered = true;
      return {};
    },
    sendToolListChanged: () => {},
  } as unknown as McpServer;
  const fakeBridge = { getGodotVersion: () => connected } as unknown as Bridge;
  registerToolWrapped(
    fakeServer,
    fakeBridge,
    "vg_tool",
    { description: "t", inputSchema: {} },
    async (): Promise<ToolTextResult> => ({ content: [{ type: "text", text: "ok" }] }),
    verOpts,
  );
  return registered;
}

// Version unknown (null) → fail-closed: tool is NOT registered.
assert.equal(gateRegisters(null, { godotMinVersion: "4.5" }), false, "null version → fail-closed (not registered)");

// Known-compatible (meets the minimum) → registered.
assert.equal(gateRegisters([4, 5], { godotMinVersion: "4.5" }), true, "4.5 meets min 4.5 → registered");
assert.equal(gateRegisters([4, 6], { godotMinVersion: "4.5" }), true, "4.6 exceeds min 4.5 → registered");

// Known-incompatible (below min) → NOT registered.
assert.equal(gateRegisters([4, 3], { godotMinVersion: "4.5" }), false, "4.3 below min 4.5 → not registered");

// Known-incompatible (above max) → NOT registered.
assert.equal(gateRegisters([4, 6], { godotMaxVersion: "4.5" }), false, "4.6 above max 4.5 → not registered");

// Inside both bounds → registered.
assert.equal(
  gateRegisters([4, 4], { godotMinVersion: "4.2", godotMaxVersion: "4.5" }),
  true,
  "4.4 within [4.2, 4.5] → registered",
);

// ── versionSupportText — range-aware UNSUPPORTED error-hint clause ──────────────
// The runtime version gate (registerToolWrapped) builds its UNSUPPORTED hint from
// this pure helper. The gate guarantees at least one bound is set, so three cases
// exist: min+max (inclusive range), min-only (or-newer), max-only (up-to). The "–"
// is an en-dash (U+2013), matched verbatim here against the helper's output.
{
  assert.equal(versionSupportText("4.2", "4.5"), "Supported on Godot 4.2–4.5 (inclusive).");
  assert.equal(versionSupportText("4.5", undefined), "Requires Godot 4.5 or newer.");
  assert.equal(versionSupportText(undefined, "4.4"), "Supported up to Godot 4.4 (inclusive).");
}
