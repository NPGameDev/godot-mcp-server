/**
 * Unit tests for group_tool_handlers.ts — createGroupToolHandler's per-tool routing
 * (concern 077, C3). Five blocks, each asserting REAL behavior via a recording
 * mock Bridge (which channel a handler hits + the method/params it forwards, and
 * the content shape it returns) — never fn === fn:
 *   1. signal_emit dual-mode — editor → bridge.call, runtime → bridge.callRuntime,
 *      with the param reshape (node_path/signal_name/args; omitted args → []).
 *   2. editor_screenshot multi-content — an image payload → buildScreenshotResult
 *      shape (image block first, then JSON metadata); empty payload → EMPTY_CONTENT.
 *   3. an LSP_TOOLS member → createLspHandler — its .cs validation fires (an
 *      LSP-handler-specific error) and the bridge is never touched (own TCP client).
 *   4. a RUNTIME_TOOLS member → callAndWrap(runtime:true) → bridge.callRuntime.
 *   5. a default tool → callAndWrap(runtime:false) → bridge.call.
 */
import assert from "node:assert/strict";
import { createGroupToolHandler } from "../../src/groups/groupToolHandlers.js";
import type { Bridge, ToolDef } from "../../src/shared/types.js";

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

// ── Block 1 — signal_emit dual-mode + param reshape ──────────────────
async function testSignalEmitDualMode() {
  // Editor mode (default) → bridge.call; params reshaped to node_path/signal_name/args.
  const editor = makeBridge();
  const editorHandler: Handler = createGroupToolHandler(editor.bridge, def("signal_emit", "scene.emit_signal"));
  await editorHandler({ node_path: "/root/Btn", signal_name: "pressed", args: [1, 2], mode: "editor" });
  assert.equal(editor.calls.length, 1, "signal_emit editor → exactly one bridge dispatch");
  assert.equal(editor.calls[0].channel, "call", "mode=editor → bridge.call (not callRuntime)");
  assert.equal(editor.calls[0].method, "scene.emit_signal", "forwards def.method");
  assert.deepEqual(
    editor.calls[0].params,
    { node_path: "/root/Btn", signal_name: "pressed", args: [1, 2] },
    "reshapes input to {node_path, signal_name, args}",
  );

  // Runtime mode → bridge.callRuntime; omitted args default to [].
  const runtime = makeBridge();
  const runtimeHandler: Handler = createGroupToolHandler(runtime.bridge, def("signal_emit", "scene.emit_signal"));
  await runtimeHandler({ node_path: "/root/Btn", signal_name: "pressed", mode: "runtime" });
  assert.equal(runtime.calls[0].channel, "callRuntime", "mode=runtime → bridge.callRuntime");
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

// ── Main ──────────────────────────────────────────────────────────────
async function main() {
  console.log("group_tool_handlers tests (concern 077 — C3):");
  await testSignalEmitDualMode();
  await testEditorScreenshot();
  await testLspRouting();
  await testRuntimeToolRouting();
  await testDefaultToolRouting();
  console.log("All 5 group_tool_handlers tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
