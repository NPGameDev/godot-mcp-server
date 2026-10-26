/**
 * Unit tests for the `debugger_get_log` handler in tools/runtime.ts, driven
 * through `register`: which side it reads (the game, or the editor at once when
 * the editor's debugger holds the game at a break) and that an editor-side tool
 * error reaches the client with its own code and hint.
 */
import assert from "node:assert/strict";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { register } from "../../src/tools/runtime.js";
import { BridgeError } from "../../src/shared/errors.js";
import type { Bridge, ToolTextResult } from "../../src/shared/types.js";

type Handler = (input: Record<string, unknown>) => Promise<ToolTextResult>;

interface FakeBridge {
  bridge: Bridge;
  /** Methods sent to the editor, in order. */
  editorCalls: string[];
  /** Methods sent to the game's runtime channel, in order. */
  runtimeCalls: string[];
}

/**
 * A bridge whose editor methods answer from `editor` and whose runtime calls
 * answer with `runtime`, counting both. An `Error` answer is thrown; an editor
 * method with no answer returns an empty object.
 */
function makeBridge(editor: Record<string, unknown>, runtime: unknown): FakeBridge {
  const editorCalls: string[] = [];
  const runtimeCalls: string[] = [];
  const answer = (a: unknown): unknown => {
    if (a instanceof Error) throw a;
    return structuredClone(a);
  };
  const fake = {
    async call(method: string) {
      editorCalls.push(method);
      return method in editor ? answer(editor[method]) : {};
    },
    async callRuntime(method: string) {
      runtimeCalls.push(method);
      return answer(runtime);
    },
    async close() {},
    getGodotVersionString: () => undefined,
    getGodotVersion: () => undefined,
  };
  // The fake leaves out the runtime-wait, headless and teardown members, which this handler never uses.
  return { bridge: fake as unknown as Bridge, editorCalls, runtimeCalls };
}

/** Register the runtime tools against `bridge` and return the `debugger_get_log` handler. */
function debuggerGetLog(bridge: Bridge): Handler {
  let handler: Handler | undefined;
  // The fake server keeps only the two members tool registration calls.
  const fakeServer = {
    registerTool: (name: string, _config: unknown, h: (input: unknown, extra?: unknown) => Promise<ToolTextResult>) => {
      if (name === "debugger_get_log") handler = (input) => h(input, {});
      return {};
    },
    sendToolListChanged: () => {},
  } as unknown as McpServer;
  register(fakeServer, bridge);
  assert.ok(handler, "debugger_get_log is registered");
  return handler;
}

/** The parsed JSON of a handler result's text block. */
function payloadOf(result: ToolTextResult): Record<string, unknown> {
  const block = result.content[0];
  assert.equal(block.type, "text", "the result carries a text block");
  return JSON.parse(block.type === "text" ? block.text : "") as Record<string, unknown>;
}

const AT_BREAK = { success: true, active: true, breaked: true, can_debug: true };
const RUNNING = { success: true, active: true, breaked: false, can_debug: false };
const EDITOR_PAGE = {
  success: true,
  lines: [],
  returned: 0,
  note: "editor-side note",
  debug_state: { active: true, breaked: true, can_debug: true },
};
const RUNTIME_PAGE = { success: true, lines: ["a", "b"], returned: 2, total_lines: 2 };
const EDITOR_TOOL_ERROR = { success: false, code: "LOG_BUSY", error: "E", hint: "H" };
const gameNotRunning = new BridgeError("GAME_NOT_RUNNING", "no game");

// ── At a break the editor side is read, never the game ───────────────
{
  const fake = makeBridge({ "debug.state": AT_BREAK, "debugger.get_log": EDITOR_PAGE }, gameNotRunning);
  const result = await debuggerGetLog(fake.bridge)({});
  assert.equal(fake.runtimeCalls.length, 0, "at a break: the runtime call is never made");
  assert.notEqual(result.isError, true, "at a break: the read succeeds");
  const payload = payloadOf(result);
  assert.equal(payload.note, "editor-side note", "at a break: the editor-side page is served");
  assert.equal(payload._summary, "no output from last game session", "at a break: the editor page's summary leads");
}

// ── With no break the game is asked first ────────────────────────────
{
  const fake = makeBridge({ "debug.state": RUNNING, "debugger.get_log": EDITOR_PAGE }, RUNTIME_PAGE);
  const result = await debuggerGetLog(fake.bridge)({});
  assert.deepEqual(fake.runtimeCalls, ["debugger.get_log"], "no break: the game is asked once");
  assert.ok(!fake.editorCalls.includes("debugger.get_log"), "no break, game answers: the editor log is not read");
  assert.equal(payloadOf(result)._summary, "2 lines (of 2 total)", "no break: the game's page is served");
}

// ── A throwing debug.state leaves the game-first path ────────────────
{
  const throwing = new BridgeError("TIMEOUT", "editor busy");
  const fake = makeBridge({ "debug.state": throwing, "debugger.get_log": EDITOR_PAGE }, RUNTIME_PAGE);
  const result = await debuggerGetLog(fake.bridge)({});
  assert.deepEqual(fake.runtimeCalls, ["debugger.get_log"], "debug.state throws: the game is asked once");
  assert.equal(payloadOf(result)._summary, "2 lines (of 2 total)", "debug.state throws: the game's page is served");
}

// ── A debug.state tool error leaves the game-first path ──────────────
{
  const failing = { success: false, code: "INTERNAL", error: "x" };
  const fake = makeBridge({ "debug.state": failing, "debugger.get_log": EDITOR_PAGE }, RUNTIME_PAGE);
  await debuggerGetLog(fake.bridge)({});
  assert.deepEqual(fake.runtimeCalls, ["debugger.get_log"], "debug.state answers an error: the game is asked once");
}

// ── The game cannot answer: the editor side's tool error is relayed ──
{
  const fake = makeBridge({ "debug.state": RUNNING, "debugger.get_log": EDITOR_TOOL_ERROR }, gameNotRunning);
  const result = await debuggerGetLog(fake.bridge)({});
  assert.equal(result.isError, true, "editor tool error after the game fails: the read is an error");
  const payload = payloadOf(result);
  assert.equal(payload.code, "LOG_BUSY", "editor tool error after the game fails: the editor's code is kept");
  assert.equal(payload.error, "E", "editor tool error after the game fails: the editor's message is kept");
  assert.equal(payload.hint, "H", "editor tool error after the game fails: the editor's hint is kept");
  assert.equal(
    fake.editorCalls.filter((m) => m === "debugger.get_log").length,
    1,
    "editor tool error after the game fails: the editor log is read once",
  );
}

// ── At a break the editor side's tool error is relayed ───────────────
{
  const fake = makeBridge({ "debug.state": AT_BREAK, "debugger.get_log": EDITOR_TOOL_ERROR }, gameNotRunning);
  const result = await debuggerGetLog(fake.bridge)({});
  assert.equal(result.isError, true, "editor tool error at a break: the read is an error");
  const payload = payloadOf(result);
  assert.equal(payload.code, "LOG_BUSY", "editor tool error at a break: the editor's code is kept");
  assert.equal(payload.hint, "H", "editor tool error at a break: the editor's hint is kept");
  assert.equal(fake.runtimeCalls.length, 0, "editor tool error at a break: the runtime call is never made");
}

// ── At a break a throwing editor read is the answer ──────────────────
{
  const editorBusy = new BridgeError("TIMEOUT", "editor busy");
  const fake = makeBridge({ "debug.state": AT_BREAK, "debugger.get_log": editorBusy }, gameNotRunning);
  const result = await debuggerGetLog(fake.bridge)({});
  assert.equal(result.isError, true, "editor read throws at a break: the read is an error");
  assert.equal(payloadOf(result).code, "TIMEOUT", "editor read throws at a break: the editor's code is kept");
  assert.equal(fake.runtimeCalls.length, 0, "editor read throws at a break: the runtime call is never made");
}

console.log("All 7 tests passed.");
