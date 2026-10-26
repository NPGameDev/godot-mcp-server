/**
 * Pins the `game_start` handler that tools/playtest.ts's `register` installs: the
 * hint it adds when the runtime is not ready, kept after any hint the toolkit sent
 * (appended on a runtime-wait timeout, left alone on a `wait_for_runtime:false`
 * launch), and the runtime wait ended early, with its own hint, when the editor's
 * debugger reports an error break or a breakpoint pause.
 */
import assert from "node:assert/strict";
import FakeTimers from "@sinonjs/fake-timers";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { register } from "../../src/tools/playtest.js";
import type { Bridge, ToolTextResult } from "../../src/shared/types.js";

type Handler = (input: Record<string, unknown>) => Promise<ToolTextResult>;

/** How the editor and the runtime wait answer during a launch that waits for the runtime. */
interface WaitScript {
  /** Answers to the editor's `debug.state`, one per call; the last repeats. An `Error` is thrown. */
  debugStates: unknown[];
  /** The editor's `debugger.get_log` answer. An `Error` is thrown. */
  log?: unknown;
  /** How long the `debugger.get_log` answer takes, in ms; absent, it answers at once. */
  logDelayMs?: number;
  /** When the runtime connects, in ms; absent, the wait runs out at its deadline. */
  connectAfterMs?: number;
  /** Receives every method sent to the editor, in order. */
  editorCalls: string[];
}

/**
 * A bridge whose `game.start` returns `result`. Without `script`, the runtime
 * wait reports no connection at once. With it, the editor answers from the
 * script and the wait runs on the (faked) clock.
 */
function makeBridge(result: Record<string, unknown>, script?: WaitScript): Bridge {
  const answer = (a: unknown): unknown => {
    if (a instanceof Error) throw a;
    return structuredClone(a);
  };
  let stateCalls = 0;
  // The fake leaves out the headless and teardown members, which game_start never uses.
  return {
    async call(method: string) {
      script?.editorCalls.push(method);
      if (script && method === "debug.state") {
        return answer(script.debugStates[Math.min(stateCalls++, script.debugStates.length - 1)]);
      }
      if (script && method === "debugger.get_log") {
        const delayMs = script.logDelayMs;
        if (delayMs !== undefined) await new Promise((resolve) => setTimeout(resolve, delayMs));
        return answer(script.log);
      }
      return structuredClone(result);
    },
    async callRuntime() {
      return {};
    },
    async waitForRuntimeConnection(timeoutMs: number) {
      if (!script) return undefined;
      const connectAfterMs = script.connectAfterMs;
      return new Promise<{ port: number } | undefined>((resolve) => {
        if (connectAfterMs !== undefined && connectAfterMs < timeoutMs) {
          setTimeout(() => resolve({ port: RUNTIME_PORT }), connectAfterMs);
        } else {
          setTimeout(() => resolve(undefined), timeoutMs);
        }
      });
    },
    async close() {},
    getGodotVersionString: () => undefined,
    getGodotVersion: () => undefined,
  } as unknown as Bridge;
}

const RUNTIME_PORT = 7001;

/** Register the playtest tools against `bridge` and return the `game_start` handler. */
function gameStart(bridge: Bridge): Handler {
  let handler: Handler | undefined;
  const fakeServer = {
    registerTool: (name: string, _config: unknown, h: (input: unknown, extra?: unknown) => Promise<ToolTextResult>) => {
      if (name === "game_start") handler = (input) => h(input, {});
      return {};
    },
    sendToolListChanged: () => {},
  } as unknown as McpServer;
  register(fakeServer, bridge);
  assert.ok(handler, "game_start is registered");
  return handler;
}

/** The `hint` field of a handler result's JSON text block. */
async function hintOf(bridgeResult: Record<string, unknown>, input: Record<string, unknown>): Promise<unknown> {
  const result = await gameStart(makeBridge(bridgeResult))(input);
  assert.notEqual(result.isError, true, "game_start succeeds");
  const block = result.content[0];
  assert.equal(block.type, "text");
  return (JSON.parse(block.type === "text" ? block.text : "") as Record<string, unknown>).hint;
}

const TOOLKIT_HINT = "The game won't open the runtime channel: GODOT_MCP_RUNTIME=0 is set.";

// ── The runtime-wait timeout (wait_for_runtime:true) ─────────────────
{
  const launched = { success: true, runtime_ready: false, runtime_port: null, runtime_discovery: "bridge" };
  const serverHint = await hintOf(launched, { wait_for_runtime: true });
  assert.equal(typeof serverHint, "string", "timeout: the server adds a hint when the toolkit set none");

  assert.equal(
    await hintOf({ ...launched, hint: TOOLKIT_HINT }, { wait_for_runtime: true }),
    `${TOOLKIT_HINT} ${serverHint as string}`,
    "timeout: the toolkit's hint is kept, the server's appended after one space",
  );
}

// ── A launch that does not wait (wait_for_runtime:false) ─────────────
{
  const launched = { success: true, runtime_ready: false, runtime_port: null };
  const serverHint = await hintOf(launched, { wait_for_runtime: false });
  assert.equal(typeof serverHint, "string", "no wait: the server adds a hint when the toolkit set none");

  assert.equal(
    await hintOf({ ...launched, hint: TOOLKIT_HINT }, { wait_for_runtime: false }),
    TOOLKIT_HINT,
    "no wait: the toolkit's hint is kept as is, with no server hint added",
  );
}

// ── The debugger checked during the runtime wait (wait_for_runtime:true) ──

const LAUNCHED = { success: true, runtime_ready: false, runtime_port: null, runtime_discovery: "bridge" };
const RUNNING = { success: true, active: true, breaked: false, can_debug: false };
const ERROR_BREAK = { success: true, active: true, breaked: true, can_debug: false };
const BREAKPOINT_PAUSE = { success: true, active: true, breaked: true, can_debug: true };

/** An editor-side debugger.get_log page whose error_buffer holds a `break` entry per message. */
function logWithBreaks(...messages: string[]): Record<string, unknown> {
  return {
    success: true,
    lines: [],
    returned: 0,
    error_buffer: messages.map((message) => ({
      timestamp_ms: 1000,
      message,
      source: "",
      function: "",
      line: 0,
      type: "break",
    })),
  };
}

const BREAK_WITH_REASON =
  'Game paused at a script error it cannot continue from: Parser Error: Identifier "speed" not declared in the current scope. ' +
  "Find the file and line with script_check or lsp_project_diagnostics, fix it, then game_stop and game_start.";
const BREAK_WITHOUT_REASON =
  "Game paused at a script error it cannot continue from. " +
  "Find the file and line with script_check or lsp_project_diagnostics, fix it, then game_stop and game_start.";
const ERROR_BREAK_HINT =
  "The game is paused at a script error and cannot continue, so waiting won't help: " +
  'Parser Error: Identifier "speed" not declared in the current scope. Fix it, then game_stop and game_start.';
const ERROR_BREAK_HINT_WITHOUT_REASON =
  "The game is paused at a script error and cannot continue, so waiting won't help. " +
  "Fix it, then game_stop and game_start.";
const BREAKPOINT_HINT = "The game is paused at a breakpoint; call debug_continue to resume.";
const TIMEOUT_HINT =
  "Game launched but runtime did not connect within 10s. " +
  "Follow up with game_start(if_running:'return', runtime_poll:true) to retry, " +
  "or check editor_get_console for startup errors.";

/** A `wait_for_runtime:true` launch in flight; `payload()` is undefined until game_start returns. */
interface WaitingLaunch {
  payload: () => Record<string, unknown> | undefined;
  editorCalls: string[];
}

/** Starts a `wait_for_runtime:true` launch against a bridge that answers from `script`. */
function launchAndWait(script: Omit<WaitScript, "editorCalls">): WaitingLaunch {
  const editorCalls: string[] = [];
  let payload: Record<string, unknown> | undefined;
  void gameStart(makeBridge(LAUNCHED, { ...script, editorCalls }))({ wait_for_runtime: true }).then((result) => {
    const block = result.content[0];
    payload = JSON.parse(block.type === "text" ? block.text : "") as Record<string, unknown>;
  });
  return { payload: () => payload, editorCalls };
}

/** How many times `method` was sent to the editor. */
function callsTo(launch: WaitingLaunch, method: string): number {
  return launch.editorCalls.filter((m) => m === method).length;
}

{
  const clock = FakeTimers.install({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const launch = launchAndWait({ debugStates: [RUNNING], connectAfterMs: 1_200 });
    await clock.tickAsync(1_200);
    assert.deepEqual(
      launch.payload(),
      {
        success: true,
        runtime_ready: true,
        runtime_port: RUNTIME_PORT,
        group_hint:
          "Game started. To interact with the running game, call discover_tools({request: 'runtime'}) to access runtime tools.",
      },
      "runtime connects while the debugger has not stopped the game: the ready payload, with no hint",
    );
  } finally {
    clock.uninstall();
  }
}

{
  const clock = FakeTimers.install({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const launch = launchAndWait({ debugStates: [RUNNING, ERROR_BREAK], log: logWithBreaks(BREAK_WITH_REASON) });
    await clock.tickAsync(2_000);
    assert.equal(
      launch.payload()?.hint,
      ERROR_BREAK_HINT,
      "an error break during the wait: game_start returns within 2 s with the error-break hint and the parser message",
    );
    assert.equal(callsTo(launch, "debugger.get_log"), 1, "an error break: one editor-side get_log reads the message");
  } finally {
    clock.uninstall();
  }
}

{
  const clock = FakeTimers.install({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const launch = launchAndWait({ debugStates: [ERROR_BREAK], log: logWithBreaks(BREAK_WITHOUT_REASON) });
    await clock.tickAsync(2_000);
    assert.equal(
      launch.payload()?.hint,
      ERROR_BREAK_HINT_WITHOUT_REASON,
      "an error break whose break entry has no error text: the error-break hint without a reason",
    );
  } finally {
    clock.uninstall();
  }
}

{
  const clock = FakeTimers.install({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const launch = launchAndWait({
      debugStates: [ERROR_BREAK],
      log: logWithBreaks(BREAK_WITHOUT_REASON, BREAK_WITH_REASON),
    });
    await clock.tickAsync(2_000);
    assert.equal(
      launch.payload()?.hint,
      ERROR_BREAK_HINT,
      "an error break with two break entries: the hint carries the latest entry's reason",
    );
  } finally {
    clock.uninstall();
  }
}

{
  const clock = FakeTimers.install({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const launch = launchAndWait({ debugStates: [BREAKPOINT_PAUSE], log: logWithBreaks(BREAK_WITH_REASON) });
    await clock.tickAsync(2_000);
    assert.equal(
      launch.payload()?.hint,
      BREAKPOINT_HINT,
      "a breakpoint pause during the wait: game_start returns within 2 s with the breakpoint hint",
    );
    assert.equal(callsTo(launch, "debugger.get_log"), 0, "a breakpoint pause: no get_log call");
  } finally {
    clock.uninstall();
  }
}

{
  const clock = FakeTimers.install({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const launch = launchAndWait({ debugStates: [RUNNING] });
    await clock.tickAsync(10_000);
    assert.equal(
      launch.payload()?.hint,
      TIMEOUT_HINT,
      "no runtime and no debugger stop within the wait: the 10 s timeout hint",
    );
  } finally {
    clock.uninstall();
  }
}

{
  const clock = FakeTimers.install({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const launch = launchAndWait({
      debugStates: [new Error("debug.state failed"), ERROR_BREAK],
      log: logWithBreaks(BREAK_WITH_REASON),
    });
    await clock.tickAsync(2_000);
    assert.equal(
      launch.payload()?.hint,
      ERROR_BREAK_HINT,
      "a debug.state call that throws is ignored: the next poll still finds the error break",
    );
  } finally {
    clock.uninstall();
  }
}

{
  const clock = FakeTimers.install({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const launch = launchAndWait({ debugStates: [ERROR_BREAK], log: new Error("debugger.get_log failed") });
    await clock.tickAsync(2_000);
    assert.equal(
      launch.payload()?.hint,
      ERROR_BREAK_HINT_WITHOUT_REASON,
      "an error break whose get_log call throws: the error-break hint without a reason",
    );
  } finally {
    clock.uninstall();
  }
}

{
  const clock = FakeTimers.install({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const launch = launchAndWait({
      debugStates: [ERROR_BREAK],
      log: logWithBreaks(
        "Game paused at a script error it cannot continue from: Parser Error: a. Find the file b. " +
          "Find the file and line with script_check or lsp_project_diagnostics, fix it, then game_stop and game_start.",
      ),
    });
    await clock.tickAsync(2_000);
    assert.equal(
      launch.payload()?.hint,
      "The game is paused at a script error and cannot continue, so waiting won't help: " +
        "Parser Error: a. Find the file b. Fix it, then game_stop and game_start.",
      "an error break whose error text holds '. Find the file': the hint carries the whole error text",
    );
  } finally {
    clock.uninstall();
  }
}

{
  const clock = FakeTimers.install({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const launch = launchAndWait({
      debugStates: [ERROR_BREAK],
      log: {
        success: true,
        lines: [],
        returned: 0,
        error_buffer: [
          {
            timestamp_ms: 1000,
            message: "Invalid call. Nonexistent function 'jump' in base 'Nil'.",
            source: "res://player.gd",
            function: "_ready",
            line: 8,
            type: "log_scan",
          },
        ],
      },
    });
    await clock.tickAsync(2_000);
    assert.equal(
      launch.payload()?.hint,
      ERROR_BREAK_HINT_WITHOUT_REASON,
      "an error break whose error_buffer holds only log_scan entries: the error-break hint without a reason",
    );
  } finally {
    clock.uninstall();
  }
}

{
  const clock = FakeTimers.install({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    // The break shows at the 500 ms poll; the get_log answer lands at 10.5 s, past the 10 s runtime-wait deadline.
    const launch = launchAndWait({
      debugStates: [ERROR_BREAK],
      log: logWithBreaks(BREAK_WITH_REASON),
      logDelayMs: 10_000,
    });
    await clock.tickAsync(11_000);
    assert.equal(
      launch.payload()?.hint,
      ERROR_BREAK_HINT,
      "an error break whose get_log answer outlasts the runtime-wait deadline: still the error-break hint",
    );
  } finally {
    clock.uninstall();
  }
}

{
  const clock = FakeTimers.install({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const launch = launchAndWait({ debugStates: [RUNNING], connectAfterMs: 1_200 });
    await clock.tickAsync(1_200);
    assert.ok(launch.payload(), "runtime connects at 1.2 s: game_start has returned");
    const polls = callsTo(launch, "debug.state");
    assert.ok(polls > 0, "while game_start waits for the runtime, it polls debug.state");
    await clock.tickAsync(5_000);
    assert.equal(callsTo(launch, "debug.state"), polls, "once game_start returns, debug.state is polled no more");
    assert.equal(clock.countTimers(), 0, "once game_start returns, no poll timer is left armed");
  } finally {
    clock.uninstall();
  }
}

console.log("All 16 tests passed.");
