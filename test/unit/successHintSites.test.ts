/**
 * Unit tests that pin the exact response text, success hint included, of every
 * site that wraps a tool handler with a success hint:
 *   1. registerTools' default handler (callAndWrap; hint resolved per call,
 *      injected before the sorted-key serialization);
 *   2. registerTools' custom-handler wrapper (hint resolved per call after the
 *      handler returns, from the same input object, and injected into the
 *      handler's first JSON text block after a successful call);
 *   3. the group path's LSP handler (the static successHint only; operationHints
 *      are ignored);
 *   4. the group path's default handler (a hint only when the tool declares
 *      operationHints; a static successHint alone is not injected).
 * Each case compares the whole text block byte for byte, so a change to which
 * hint a site picks, where the hint lands in the payload or how the payload is
 * serialized fails here.
 */
import assert from "node:assert/strict";
import { registerTools } from "../../src/registration/toolRegistry.js";
import { createGroupToolHandler } from "../../src/groups/groupToolHandlers.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Bridge, ToolDef, ToolTextResult } from "../../src/shared/types.js";

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

// ── Site 1: registerTools default handler ────────────────────────────
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

// ── Site 2: registerTools custom-handler wrapper ─────────────────────
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

// ── Site 3: group LSP handler ────────────────────────────────────────
// lsp_diagnostics on a shader returns a success before any socket opens, so the
// LSP path's injection runs without an editor; the closed port turns any
// accidental connect into an LSP_UNAVAILABLE error instead of a hang.
{
  const prevPort = process.env.GODOT_MCP_LSP_PORT;
  process.env.GODOT_MCP_LSP_PORT = "59999";
  try {
    const { bridge, calls } = makeBridge({ success: true });
    const lspDef = (hints: Partial<ToolDef>): ToolDef => ({
      ...tool("lsp_diagnostics", hints),
      method: "lsp.diagnostics",
    });
    const shader = { file_path: "res://fx/pin.gdshader" };
    const bare = await createGroupToolHandler(bridge, lspDef({}))(shader);
    const bareText = text(bare);
    assert.equal(bare.isError, undefined, "site 3: the shader short-circuit is a success");
    assert.ok(!("hint" in JSON.parse(bareText)), "site 3: no hint declared, none injected");

    const withHint = text(await createGroupToolHandler(bridge, lspDef(STATIC_ONLY))(shader));
    const expected = JSON.stringify({ ...JSON.parse(bareText), hint: "static" });
    assert.equal(withHint, expected, "site 3: the static hint is appended to the handler's JSON");

    assert.equal(
      text(await createGroupToolHandler(bridge, lspDef(BOTH))({ ...shader, action: "rename" })),
      expected,
      "site 3: operationHints are ignored on the LSP path",
    );

    const opOnly = { operationParam: "action", operationHints: { rename: "renamed" } };
    assert.equal(
      text(await createGroupToolHandler(bridge, lspDef(opOnly))({ ...shader, action: "rename" })),
      bareText,
      "site 3: operationHints without a static hint inject nothing",
    );

    const failed = await createGroupToolHandler(bridge, lspDef(STATIC_ONLY))({ file_path: "res://player.cs" });
    assert.equal(failed.isError, true, "site 3: a rejected input is an error result");
    assert.ok(!("hint" in JSON.parse(text(failed))), "site 3: no success hint on an error");
    assert.equal(calls.length, 0, "site 3: the LSP path never touches the bridge");
  } finally {
    if (prevPort === undefined) delete process.env.GODOT_MCP_LSP_PORT;
    else process.env.GODOT_MCP_LSP_PORT = prevPort;
  }
}

// ── Site 4: group default handler ────────────────────────────────────
{
  const payload = { success: true, zeta: 1, alpha: { b: 2, a: 1 } };
  const { bridge, calls } = makeBridge(payload);
  const group = (name: string, hints: Partial<ToolDef>) => createGroupToolHandler(bridge, tool(name, hints)) as Handler;

  const signal = new AbortController().signal;
  assert.equal(
    text(await group("g_both", BOTH)({ action: "rename" }, signal)),
    '{"alpha":{"a":1,"b":2},"hint":"renamed","success":true,"zeta":1}',
    "site 4: a listed operation gets its own hint",
  );
  assert.equal(calls[0].signal, undefined, "site 4: the group path does not forward the signal");
  assert.equal(
    text(await group("g_both", BOTH)({ action: "add" })),
    '{"alpha":{"a":1,"b":2},"hint":"static","success":true,"zeta":1}',
    "site 4: an unlisted operation falls back to the static hint",
  );
  assert.equal(
    text(await group("g_static", STATIC_ONLY)({})),
    '{"alpha":{"a":1,"b":2},"success":true,"zeta":1}',
    "site 4: a static hint alone is not injected",
  );
  assert.equal(
    text(await group("g_none", {})({})),
    '{"alpha":{"a":1,"b":2},"success":true,"zeta":1}',
    "site 4: no hint declared, none injected",
  );

  const runtime = makeBridge(payload);
  const rt = createGroupToolHandler(runtime.bridge, tool("runtime_get_node_state", BOTH)) as Handler;
  assert.equal(
    text(await rt({ action: "rename" })),
    '{"alpha":{"a":1,"b":2},"hint":"renamed","success":true,"zeta":1}',
    "site 4: the runtime route resolves the same hint",
  );
}
{
  const { bridge } = makeBridge({ success: true, hint: "toolkit" });
  const h = createGroupToolHandler(bridge, tool("g_kept", BOTH)) as Handler;
  assert.equal(text(await h({ action: "rename" })), '{"hint":"toolkit","success":true}', "site 4: toolkit hint kept");
}

console.log("success-hint site tests passed.");
