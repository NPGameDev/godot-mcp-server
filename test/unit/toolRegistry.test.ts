/**
 * Unit tests for toolRegistry.ts — the tool-registration wrappers:
 * registerToolWrapped (path-guard dispatch wiring + version-gate filtering),
 * batchToolRegistration (notification collapse), versionSupportText, and
 * registerTools' per-operation success hints and the exact response text of
 * its default and custom-handler hint sites.
 */

import assert from "node:assert/strict";
import {
  registerToolWrapped,
  registerTools,
  batchToolRegistration,
  versionSupportText,
} from "../../src/registration/toolRegistry.js";
import { PROJECT_FILE_PATH } from "../../src/security/pathGuard.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Bridge, PathGuard, ToolDef, ToolTextResult } from "../../src/shared/types.js";

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

// ── per-operation success hints (registerTools) ──────────────────────
// A def with operationHints gets each operation's own hint on both the default
// callAndWrap handler and a custom handler; an unlisted operation gets successHint.
{
  const handlers = new Map<string, (input: Record<string, unknown>) => Promise<ToolTextResult>>();
  const fakeServer = {
    registerTool: (n: string, _c: unknown, h: (input: Record<string, unknown>) => Promise<ToolTextResult>) => {
      handlers.set(n, h);
      return {};
    },
    sendToolListChanged: () => {},
  } as unknown as McpServer;
  const fakeBridge = {
    call: async () => ({ success: true }),
    getGodotVersion: () => null,
  } as unknown as Bridge;
  const hinted = (name: string): ToolDef => ({
    name,
    method: "op.hints",
    description: "t",
    inputSchema: {},
    operationParam: "action",
    successHint: "static",
    operationHints: { rename: "renamed" },
  });
  const custom = new Map([
    [
      "op_hints_custom",
      async (): Promise<ToolTextResult> => ({ content: [{ type: "text", text: JSON.stringify({ success: true }) }] }),
    ],
  ]);
  registerTools(fakeServer, fakeBridge, [hinted("op_hints_default"), hinted("op_hints_custom")], undefined, {
    handlers: custom,
  });
  for (const name of ["op_hints_default", "op_hints_custom"]) {
    const hintOf = async (action: string) => JSON.parse((await handlers.get(name)!({ action })).content[0].text).hint;
    assert.equal(await hintOf("rename"), "renamed", `${name}: rename gets its own hint`);
    assert.equal(await hintOf("add"), "static", `${name}: an unlisted operation gets successHint`);
  }
}

// ── version-tailored descriptions (registerTools) ────────────────────
// A def with describe is registered with describe(connected version), `null` while the
// version is unknown; a def without it keeps its static description.
{
  const registered = new Map<string, string>();
  const fakeServer = {
    registerTool: (n: string, config: { description: string }) => {
      registered.set(n, config.description);
      return {};
    },
    sendToolListChanged: () => {},
  } as unknown as McpServer;
  const bridgeAt = (version: [number, number] | undefined) =>
    ({ call: async () => ({ success: true }), getGodotVersion: () => version }) as unknown as Bridge;
  const tailored: ToolDef = {
    name: "desc_tailored",
    method: "desc.tailored",
    description: "fallback",
    describe: (v) => (v == null ? "fallback" : `for ${v[0]}.${v[1]}`),
    inputSchema: {},
  };
  const plain: ToolDef = { name: "desc_plain", method: "desc.plain", description: "static", inputSchema: {} };

  registerTools(fakeServer, bridgeAt([4, 5]), [tailored, plain]);
  assert.equal(registered.get("desc_tailored"), "for 4.5", "describe receives the connected version");
  assert.equal(registered.get("desc_plain"), "static", "a def without describe keeps its description");

  registerTools(fakeServer, bridgeAt(undefined), [tailored]);
  assert.equal(registered.get("desc_tailored"), "fallback", "describe receives null while the version is unknown");
}

// ── success-hint response text (registerTools) ───────────────────────
// Pins the exact response text, success hint included, of registerTools' two
// hint sites: the default handler (callAndWrap; hint resolved per call,
// injected before the sorted-key serialization) and the custom-handler wrapper
// (hint resolved per call after the handler returns, from the same input
// object, and injected after a successful call into the first text block
// holding a JSON object with no non-empty hint, unless a JSON array block comes
// first). Each hinted case compares the whole text block byte for byte, so a
// change to which hint a site picks, where the hint lands in the payload or how
// the payload is serialized fails here.

type Handler = (input: unknown, signal?: AbortSignal) => Promise<ToolTextResult>;
type Recorded = { method: string; params: unknown; signal: AbortSignal | undefined };

/** A bridge whose editor and runtime calls record their arguments and return `ret`. */
function makeBridge(ret: unknown) {
  const calls: Recorded[] = [];
  const bridge = {
    async call(method: string, params: unknown, _timeoutMs?: number, signal?: AbortSignal) {
      calls.push({ method, params, signal });
      return structuredClone(ret);
    },
    async callRuntime(method: string, params: unknown, _timeoutMs?: number, signal?: AbortSignal) {
      calls.push({ method, params, signal });
      return structuredClone(ret);
    },
    async close() {},
    getGodotVersionString: () => undefined,
    getGodotVersion: () => undefined,
  } as unknown as Bridge;
  return { bridge, calls };
}

/** A handler as the SDK calls it: the arguments, then `extra` carrying the call's signal. */
type SdkHandler = (input: unknown, extra?: { signal?: AbortSignal }) => Promise<ToolTextResult>;

/**
 * Register `tools` through registerTools and return each registered handler,
 * taking the signal as a plain second argument and passing it on the way the
 * SDK does.
 */
function registerAll(bridge: Bridge, tools: ToolDef[], custom?: Map<string, Handler>): Map<string, Handler> {
  const handlers = new Map<string, Handler>();
  const fakeServer = {
    registerTool: (name: string, _config: unknown, handler: SdkHandler) => {
      handlers.set(name, (input, signal) => handler(input, { signal }));
      return {};
    },
    sendToolListChanged: () => {},
  } as unknown as McpServer;
  registerTools(fakeServer, bridge, tools, undefined, {
    handlers: custom as Map<string, (input: Record<string, unknown>) => Promise<ToolTextResult>> | undefined,
  });
  return handlers;
}

const tool = (name: string, hints: Partial<ToolDef>): ToolDef => ({
  name,
  method: `pin.${name}`,
  description: "t",
  inputSchema: {},
  ...hints,
});

const BOTH: Partial<ToolDef> = {
  operationParam: "action",
  successHint: "static",
  operationHints: { rename: "renamed" },
};
const STATIC_ONLY: Partial<ToolDef> = { successHint: "static" };

const text = (result: ToolTextResult): string => result.content.map((b) => (b.type === "text" ? b.text : "")).join("|");

// Site 1: the default handler.
{
  const payload = { success: true, zeta: 1, alpha: { b: 2, a: 1 } };
  const { bridge, calls } = makeBridge(payload);
  const h = registerAll(bridge, [tool("d_both", BOTH), tool("d_static", STATIC_ONLY), tool("d_none", {})]);

  const signal = new AbortController().signal;
  assert.equal(
    text(await h.get("d_both")!({ action: "rename" }, signal)),
    '{"alpha":{"a":1,"b":2},"hint":"renamed","success":true,"zeta":1}',
    "site 1: a listed operation gets its own hint, in sorted-key position",
  );
  assert.equal(calls[0].signal, signal, "site 1: the call's signal reaches the bridge");
  assert.deepEqual(calls[0].params, { action: "rename" }, "site 1: the input is forwarded unchanged");
  assert.equal(
    text(await h.get("d_both")!({ action: "add" })),
    '{"alpha":{"a":1,"b":2},"hint":"static","success":true,"zeta":1}',
    "site 1: an unlisted operation gets the static hint",
  );
  assert.equal(
    text(await h.get("d_static")!({})),
    '{"alpha":{"a":1,"b":2},"hint":"static","success":true,"zeta":1}',
    "site 1: a static hint alone is injected",
  );
  assert.equal(
    text(await h.get("d_none")!({})),
    '{"alpha":{"a":1,"b":2},"success":true,"zeta":1}',
    "site 1: no hint declared, none injected",
  );
}
{
  const { bridge } = makeBridge({ success: true, hint: "toolkit" });
  const h = registerAll(bridge, [tool("d_kept", BOTH)]);
  assert.equal(
    text(await h.get("d_kept")!({ action: "rename" })),
    '{"hint":"toolkit","success":true}',
    "site 1: a toolkit hint is never overwritten",
  );
}
{
  const { bridge } = makeBridge({ success: false, code: "INVALID_PARAMS", error: "bad" });
  const h = registerAll(bridge, [tool("d_err", BOTH)]);
  const res = await h.get("d_err")!({ action: "rename" });
  assert.equal(res.isError, true, "site 1: an error payload is an error result");
  assert.equal(text(res), '{"success":false,"error":"bad","code":"INVALID_PARAMS"}', "site 1: no hint on an error");
}
{
  const { bridge } = makeBridge([{ b: 1, a: 2 }]);
  const h = registerAll(bridge, [tool("d_array", STATIC_ONLY)]);
  assert.equal(text(await h.get("d_array")!({})), '[{"a":2,"b":1}]', "site 1: an array payload carries no hint");
}

// Site 2: the custom-handler wrapper.
{
  const { bridge, calls } = makeBridge({ success: true });
  const seen: (AbortSignal | undefined)[] = [];
  const customText = (body: string, isError?: true): Handler => {
    return async (_input, signal) => {
      seen.push(signal);
      return isError
        ? { content: [{ type: "text", text: body }], isError }
        : { content: [{ type: "text", text: body }] };
    };
  };
  const unsorted = JSON.stringify({ success: true, zeta: 1, alpha: { b: 2, a: 1 } });
  const custom = new Map<string, Handler>([
    ["c_both", customText(unsorted)],
    ["c_static", customText(unsorted)],
    ["c_none", customText(unsorted)],
    ["c_kept", customText(JSON.stringify({ hint: "own", success: true }))],
    ["c_err", customText(JSON.stringify({ success: false, code: "X", error: "e" }), true)],
    [
      "c_multi",
      async () => ({
        content: [
          { type: "text", text: "plain prose" },
          { type: "text", text: '{"z":1,"a":2}' },
        ],
      }),
    ],
    [
      "c_mutating",
      async (input) => {
        (input as Record<string, unknown>).action = "rename";
        return { content: [{ type: "text", text: '{"success":true}' }] };
      },
    ],
  ]);
  const h = registerAll(
    bridge,
    [
      tool("c_both", BOTH),
      tool("c_static", STATIC_ONLY),
      tool("c_none", {}),
      tool("c_kept", BOTH),
      tool("c_err", BOTH),
      tool("c_multi", STATIC_ONLY),
      tool("c_mutating", BOTH),
    ],
    custom,
  );

  const signal = new AbortController().signal;
  assert.equal(
    text(await h.get("c_both")!({ action: "rename" }, signal)),
    '{"success":true,"zeta":1,"alpha":{"b":2,"a":1},"hint":"renamed"}',
    "site 2: a listed operation's hint is appended, key order kept",
  );
  assert.equal(seen[0], signal, "site 2: the call's signal reaches the custom handler");
  assert.equal(
    text(await h.get("c_both")!({ action: "add" })),
    '{"success":true,"zeta":1,"alpha":{"b":2,"a":1},"hint":"static"}',
    "site 2: an unlisted operation gets the static hint",
  );
  assert.equal(
    text(await h.get("c_static")!({})),
    '{"success":true,"zeta":1,"alpha":{"b":2,"a":1},"hint":"static"}',
    "site 2: a static hint alone is injected",
  );
  assert.equal(text(await h.get("c_none")!({})), unsorted, "site 2: no hint declared, the text is untouched");
  assert.equal(
    text(await h.get("c_kept")!({ action: "rename" })),
    '{"hint":"own","success":true}',
    "site 2: own hint kept",
  );
  const err = await h.get("c_err")!({ action: "rename" });
  assert.equal(err.isError, true, "site 2: the error flag is kept");
  assert.equal(text(err), '{"success":false,"code":"X","error":"e"}', "site 2: no hint on an error result");
  assert.equal(
    text(await h.get("c_multi")!({})),
    'plain prose|{"z":1,"a":2,"hint":"static"}',
    "site 2: the hint lands in the first JSON text block",
  );
  assert.equal(
    text(await h.get("c_mutating")!({ action: "add" })),
    '{"success":true,"hint":"renamed"}',
    "site 2: the hint is resolved after the call, from the input the handler may have changed",
  );
  assert.equal(calls.length, 0, "site 2: a custom handler replaces the bridge call");
}
