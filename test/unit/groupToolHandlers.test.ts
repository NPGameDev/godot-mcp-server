/**
 * Unit tests for group_tool_handlers.ts — createGroupToolHandler's per-tool routing
 * Eight blocks, each asserting REAL behavior via a recording
 * mock Bridge (which channel a handler hits + the method/params it forwards, and
 * the content shape it returns) — never fn === fn:
 *   1. signal_emit dual-mode — editor → bridge.call, runtime → bridge.callRuntime,
 *      with the param reshape (node_path/signal_name/args; omitted args → []).
 *   2. editor_screenshot multi-content — an image payload → buildScreenshotResult
 *      shape (image block first, then JSON metadata); empty payload → EMPTY_CONTENT;
 *      the image_detail/returned disclosure threads through the inline + disk branches.
 *   3. an LSP_TOOLS member → createLspHandler — its .cs validation fires (an
 *      LSP-handler-specific error) and the bridge is never touched (own TCP client).
 *   4. a RUNTIME_TOOLS member → callAndWrap(runtime:true) → bridge.callRuntime.
 *   5. a default tool → callAndWrap(runtime:false) → bridge.call.
 *   6. a tool with per-operation hints (input_map_action) → each operation's own
 *      success hint on this path; its keys are operations the tool accepts.
 *   7. the LSP route's success-hint text — the static successHint only;
 *      operationHints are ignored.
 *   8. the default route's success-hint text — a hint only when the tool declares
 *      operationHints (a static successHint alone is not injected); the call's
 *      signal is not forwarded. Each hinted case in 7-8 compares the whole text
 *      block, so a change to which hint the route picks or where it lands fails.
 */
import assert from "node:assert/strict";
import { createGroupToolHandler } from "../../src/groups/groupToolHandlers.js";
import type { z } from "zod";
import { inputMapTools } from "../../src/tools/inputMap.js";
import type { Bridge, ToolDef, ToolTextResult } from "../../src/shared/types.js";

// The union of handler shapes createGroupToolHandler returns is uniformly callable with
// one unknown input and yields a promise; widen to this for the assertions.
type Handler = (input: unknown) => Promise<unknown>;

// ── Recording mock Bridge ────────────────────────────────────────────
// Captures which channel (call = editor, callRuntime = runtime) a handler
// dispatches through, plus the forwarded method + params. close/version members
// satisfy the Bridge interface but are unused here.
type Recorded = { channel: "call" | "callRuntime"; method: string; params: unknown };
function makeBridge(ret: unknown = { success: true, value: 1 }) {
  const calls: Recorded[] = [];
  const bridge: Bridge = {
    async call(method, params) {
      calls.push({ channel: "call", method, params });
      return ret;
    },
    async callRuntime(method, params) {
      calls.push({ channel: "callRuntime", method, params });
      return ret;
    },
    async close() {},
    getGodotVersionString() {
      return null;
    },
    getGodotVersion() {
      return null;
    },
  };
  return { bridge, calls };
}

// Minimal ToolDef — createGroupToolHandler + the handlers read only `name` and `method`.
const def = (name: string, method: string): ToolDef => ({
  name,
  method,
  description: `does ${name}`,
  inputSchema: {},
});

// ── Block 1 — signal_emit channel routing + param reshape ────────────
async function testSignalEmitDualMode() {
  // Editor channel (default) → bridge.call; params reshaped to node_path/signal_name/args.
  const editor = makeBridge();
  const editorHandler: Handler = createGroupToolHandler(editor.bridge, def("signal_emit", "scene.emit_signal"));
  await editorHandler({ node_path: "/root/Btn", signal_name: "pressed", args: [1, 2], channel: "editor" });
  assert.equal(editor.calls.length, 1, "signal_emit editor → exactly one bridge dispatch");
  assert.equal(editor.calls[0].channel, "call", "channel=editor → bridge.call (not callRuntime)");
  assert.equal(editor.calls[0].method, "scene.emit_signal", "forwards def.method");
  assert.deepEqual(
    editor.calls[0].params,
    { node_path: "/root/Btn", signal_name: "pressed", args: [1, 2] },
    "reshapes input to {node_path, signal_name, args}",
  );

  // Runtime channel → bridge.callRuntime; omitted args default to [].
  // Only the exact value "runtime" routes to the runtime bridge here: the schema
  // maps the hidden "game" alias to "runtime" upstream, so the handler never sees
  // a raw alias (that mapping is locked in channelSelector.test.ts).
  const runtime = makeBridge();
  const runtimeHandler: Handler = createGroupToolHandler(runtime.bridge, def("signal_emit", "scene.emit_signal"));
  await runtimeHandler({ node_path: "/root/Btn", signal_name: "pressed", channel: "runtime" });
  assert.equal(runtime.calls[0].channel, "callRuntime", "channel=runtime → bridge.callRuntime");
  assert.deepEqual(
    runtime.calls[0].params,
    { node_path: "/root/Btn", signal_name: "pressed", args: [] },
    "omitted args default to []",
  );
}

// ── Block 2 — editor_screenshot multi-content + EMPTY_CONTENT ─────────
async function testEditorScreenshot() {
  // An image payload → the buildScreenshotResult shape: image block first, then a
  // JSON metadata text block (width/height/bytes/path; mime_type passed through).
  const ok = makeBridge({
    image_base64: "QUJD",
    mime_type: "image/jpeg",
    width: 320,
    height: 240,
    bytes: 4096,
    path: "res://shot.png",
  });
  const shotHandler: Handler = createGroupToolHandler(ok.bridge, def("editor_screenshot", "editor.screenshot"));
  const shot = (await shotHandler({})) as {
    content: ({ type: "image"; data: string; mimeType: string } | { type: "text"; text: string })[];
  };
  assert.equal(ok.calls[0].channel, "call", "editor_screenshot dispatches on the editor bridge");
  assert.equal(shot.content.length, 2, "screenshot → multi-content (image + metadata)");
  assert.deepEqual(
    shot.content[0],
    { type: "image", data: "QUJD", mimeType: "image/jpeg" },
    "content[0] is the image block (data + mimeType passed through)",
  );
  assert.equal(shot.content[1].type, "text", "content[1] is the metadata text block");
  assert.deepEqual(
    JSON.parse((shot.content[1] as { type: "text"; text: string }).text),
    { width: 320, height: 240, bytes: 4096, path: "res://shot.png" },
    "metadata block carries width/height/bytes/path",
  );

  // An empty payload (no image_base64) → EMPTY_CONTENT error.
  const empty = makeBridge({});
  const emptyHandler: Handler = createGroupToolHandler(empty.bridge, def("editor_screenshot", "editor.screenshot"));
  const errRes = (await emptyHandler({})) as { isError?: true; content: { type: "text"; text: string }[] };
  assert.equal(errRes.isError, true, "empty screenshot payload → isError");
  assert.equal(
    JSON.parse(errRes.content[0].text).code,
    "EMPTY_CONTENT",
    "empty screenshot payload → EMPTY_CONTENT code",
  );

  // Disclosure relay — the on-demand group path must carry the same never-silent
  // image_detail/returned disclosure the dedicated capture handler does, on BOTH
  // branches. Inline branch: the fields thread into the metadata text block.
  const detail = makeBridge({
    image_base64: "QUJD",
    mime_type: "image/png",
    width: 1024,
    height: 495,
    bytes: 8000,
    path: "res://shot.png",
    image_detail: "mid",
    returned: "1024x495",
  });
  const detailHandler: Handler = createGroupToolHandler(detail.bridge, def("editor_screenshot", "editor.screenshot"));
  const detailShot = (await detailHandler({})) as { content: { type: string; text?: string }[] };
  const detailMeta = JSON.parse((detailShot.content[1] as { text: string }).text);
  assert.equal(detailMeta.image_detail, "mid", "inline group screenshot threads the applied image_detail");
  assert.equal(detailMeta.returned, "1024x495", "inline group screenshot threads the returned WxH");

  // Disk branch: a disk-only capture (no image bytes) → lean text envelope that must
  // also carry image_detail + returned.
  const disk = makeBridge({
    mime_type: "image/png",
    width: 1996,
    height: 965,
    bytes: 120000,
    path: "user://screenshots/shot.png",
    hint: "Saved full-res → user://screenshots/shot.png. Read it for pixel detail without re-capturing.",
    image_detail: "full",
    returned: "1996x965",
  });
  const diskHandler: Handler = createGroupToolHandler(disk.bridge, def("editor_screenshot", "editor.screenshot"));
  const diskShot = (await diskHandler({})) as { content: { type: string; text: string }[] };
  const diskMeta = JSON.parse(diskShot.content[0].text);
  assert.equal(diskMeta.image_detail, "full", "disk group screenshot threads the applied image_detail");
  assert.equal(diskMeta.returned, "1996x965", "disk group screenshot threads the returned WxH");
}

// ── Block 3 — LSP tool routes to createLspHandler (bridge untouched) ──
async function testLspRouting() {
  // An LSP_TOOLS member routes to createLspHandler, whose handler uses its own
  // TCP client — not the bridge. The .gd-only path validation (rejecting .cs)
  // fires BEFORE any connection, so this is deterministic + offline: the
  // LSP-specific UNSUPPORTED_FILE_TYPE error proves the LSP route, and the bridge
  // stays cold (no editor/runtime dispatch).
  const { bridge, calls } = makeBridge();
  const lspHandler: Handler = createGroupToolHandler(bridge, def("lsp_hover", "lsp.hover"));
  const res = (await lspHandler({ file_path: "res://player.cs", line: 0, column: 0 })) as {
    isError?: true;
    content: { type: "text"; text: string }[];
  };
  assert.equal(calls.length, 0, "LSP tool never touches the bridge (own TCP client)");
  assert.equal(res.isError, true, "LSP handler validated the input and returned an error");
  assert.equal(
    JSON.parse(res.content[0].text).code,
    "UNSUPPORTED_FILE_TYPE",
    "the .cs rejection is LSP-handler-specific — proves routing to createLspHandler",
  );
}

// ── Block 4 — runtime tool → callAndWrap(runtime:true) ───────────────
async function testRuntimeToolRouting() {
  const { bridge, calls } = makeBridge();
  const handler: Handler = createGroupToolHandler(bridge, def("runtime_get_node_state", "runtime.get_node_state"));
  await handler({ node_path: "/root/Game" });
  assert.equal(calls.length, 1, "runtime tool → one dispatch");
  assert.equal(calls[0].channel, "callRuntime", "RUNTIME_TOOLS member → callAndWrap(runtime:true) → callRuntime");
  assert.equal(calls[0].method, "runtime.get_node_state", "forwards def.method");
  assert.deepEqual(calls[0].params, { node_path: "/root/Game" }, "forwards input unchanged");
}

// ── Block 5 — default tool → callAndWrap(runtime:false) ──────────────
async function testDefaultToolRouting() {
  const { bridge, calls } = makeBridge();
  const handler: Handler = createGroupToolHandler(bridge, def("node_create", "scene.create_node"));
  await handler({ parent_path: "/root", type: "Node2D" });
  assert.equal(calls.length, 1, "default tool → one dispatch");
  assert.equal(calls[0].channel, "call", "default tool → callAndWrap(runtime:false) → editor bridge.call");
  assert.equal(calls[0].method, "scene.create_node", "forwards def.method");
  assert.deepEqual(calls[0].params, { parent_path: "/root", type: "Node2D" }, "forwards input unchanged");
}

// ── Block 6 — per-operation success hints on the group path ──────────
async function testOperationHints() {
  const actionDef = inputMapTools.find((t) => t.name === "input_map_action")!;
  assert.ok(actionDef.operationHints, "input_map_action declares per-operation hints");
  const operations = (actionDef.inputSchema[actionDef.operationParam!] as z.ZodEnum).options;
  for (const key of Object.keys(actionDef.operationHints!)) {
    assert.ok(operations.includes(key), `operationHints key '${key}' is one of the tool's operations`);
  }

  const hintFor = async (input: Record<string, unknown>, ret: unknown = { success: true }) => {
    const { bridge } = makeBridge(ret);
    const handler = createGroupToolHandler(bridge, actionDef) as (
      i: unknown,
    ) => Promise<{ content: { text: string }[]; isError?: boolean }>;
    return JSON.parse((await handler(input)).content[0].text).hint as string | undefined;
  };
  assert.equal(await hintFor({ action: "add", name: "jump" }), actionDef.successHint, "add gets the static hint");
  assert.equal(
    await hintFor({ action: "rename", name: "jump", new_name: "leap" }),
    actionDef.operationHints!.rename,
    "rename gets its own hint",
  );
  assert.equal(await hintFor({ action: "remove", name: "jump" }), actionDef.operationHints!.remove);
  assert.equal(
    await hintFor({ action: "rename", name: "jump" }, { success: false, code: "INVALID_PARAMS", error: "x" }),
    undefined,
    "an error result carries no success hint",
  );
}

// ── Success-hint text fixtures (blocks 7-8) ──────────────────────────
type HintHandler = (input: unknown, signal?: AbortSignal) => Promise<ToolTextResult>;
type SignalRecorded = { method: string; params: unknown; signal: AbortSignal | undefined };

/** A bridge whose editor and runtime calls record their arguments and return `ret`. */
function makeSignalBridge(ret: unknown) {
  const calls: SignalRecorded[] = [];
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

// ── Block 7 — success-hint text on the LSP route (site 3) ────────────
// lsp_diagnostics on a shader returns a success before any socket opens, so the
// LSP path's injection runs without an editor; the closed port turns any
// accidental connect into an LSP_UNAVAILABLE error instead of a hang.
async function testLspSuccessHint() {
  const prevPort = process.env.GODOT_MCP_LSP_PORT;
  process.env.GODOT_MCP_LSP_PORT = "59999";
  try {
    const { bridge, calls } = makeSignalBridge({ success: true });
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

// ── Block 8 — success-hint text on the default route (site 4) ────────
async function testDefaultSuccessHint() {
  {
    const payload = { success: true, zeta: 1, alpha: { b: 2, a: 1 } };
    const { bridge, calls } = makeSignalBridge(payload);
    const group = (name: string, hints: Partial<ToolDef>) =>
      createGroupToolHandler(bridge, tool(name, hints)) as HintHandler;

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

    const runtime = makeSignalBridge(payload);
    const rt = createGroupToolHandler(runtime.bridge, tool("runtime_get_node_state", BOTH)) as HintHandler;
    assert.equal(
      text(await rt({ action: "rename" })),
      '{"alpha":{"a":1,"b":2},"hint":"renamed","success":true,"zeta":1}',
      "site 4: the runtime route resolves the same hint",
    );
  }
  {
    const { bridge } = makeSignalBridge({ success: true, hint: "toolkit" });
    const h = createGroupToolHandler(bridge, tool("g_kept", BOTH)) as HintHandler;
    assert.equal(text(await h({ action: "rename" })), '{"hint":"toolkit","success":true}', "site 4: toolkit hint kept");
  }
}

// ── Main ──────────────────────────────────────────────────────────────
async function main() {
  console.log("group_tool_handlers tests:");
  await testSignalEmitDualMode();
  await testEditorScreenshot();
  await testLspRouting();
  await testRuntimeToolRouting();
  await testDefaultToolRouting();
  await testOperationHints();
  await testLspSuccessHint();
  await testDefaultSuccessHint();
  console.log("All 8 group_tool_handlers tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
