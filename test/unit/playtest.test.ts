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
  /** The answer to the second and later `debugger.get_log` calls; absent, they answer as `log` does. */
  reread?: unknown;
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
  let logCalls = 0;
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
        return answer(logCalls++ > 0 && "reread" in script ? script.reread : script.log);
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
    assert.equal(
      callsTo(launch, "debugger.get_log"),
      2,
      "an error break with an unlocated entry: one editor-side get_log reads the message, then one re-read",
    );
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

// ── An error break's location, from the break entry's source and line fields ──

/** An editor-side debugger.get_log page whose error_buffer holds one `break` entry at `source`:`line`. */
function logWithLocatedBreak(message: string, source: string, line: number): Record<string, unknown> {
  return {
    success: true,
    lines: [],
    returned: 0,
    error_buffer: [{ timestamp_ms: 1000, message, source, function: "", line, type: "break" }],
  };
}

/** The hint game_start returns when the debugger reports an error break and the editor-side get_log answers `log`. */
async function errorBreakHintWith(log: unknown): Promise<unknown> {
  const clock = FakeTimers.install({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const launch = launchAndWait({ debugStates: [ERROR_BREAK], log });
    await clock.tickAsync(2_000);
    return launch.payload()?.hint;
  } finally {
    clock.uninstall();
  }
}

const PRELOAD_REASON = 'Parser Error: Could not preload resource script "res://cases/preload_inner.gd"';

{
  const hint = await errorBreakHintWith(
    logWithLocatedBreak(
      'Game paused at a script error it cannot continue from: Parser Error: Identifier "speed" not declared in the current scope, ' +
        "at res://player.gd:12. Fix it, then game_stop and game_start.",
      "res://player.gd",
      12,
    ),
  );
  assert.equal(
    hint,
    "The game is paused at a script error and cannot continue, so waiting won't help: " +
      'Parser Error: Identifier "speed" not declared in the current scope, at res://player.gd:12. ' +
      "Fix it, then game_stop and game_start.",
    "a located break entry: the hint carries the reason, then the entry's file and line",
  );
}

{
  const hint = await errorBreakHintWith(
    logWithLocatedBreak(
      "Game paused at a script error it cannot continue from, at res://player.gd:12. Fix it, then game_stop and game_start.",
      "res://player.gd",
      12,
    ),
  );
  assert.equal(
    hint,
    "The game is paused at a script error and cannot continue, so waiting won't help, at res://player.gd:12. " +
      "Fix it, then game_stop and game_start.",
    "a located break entry without a reason: the hint carries the file and line without an error clause",
  );
}

{
  const hint = await errorBreakHintWith(
    logWithLocatedBreak(
      "Game paused at a script error it cannot continue from: Parser Error: x. Fix it, then game_stop and game_start.",
      "",
      0,
    ),
  );
  assert.equal(
    hint,
    "The game is paused at a script error and cannot continue, so waiting won't help: Parser Error: x. " +
      "Fix it, then game_stop and game_start.",
    "a break entry ending '. Fix it' with no '. Find the file': the hint still carries the reason",
  );
}

{
  const hint = await errorBreakHintWith(logWithLocatedBreak(BREAK_WITH_REASON, "res://player.gd", 0));
  assert.equal(hint, ERROR_BREAK_HINT, "a break entry with a source but line 0: the hint has no location clause");
}

{
  const hint = await errorBreakHintWith(logWithLocatedBreak(BREAK_WITH_REASON, "", 12));
  assert.equal(hint, ERROR_BREAK_HINT, "a break entry with a line but no source: the hint has no location clause");
}

{
  const hint = await errorBreakHintWith(
    logWithLocatedBreak(
      `Game paused at a script error it cannot continue from: ${PRELOAD_REASON}, at res://cases/preload_outer.gd:4. ` +
        "The preloaded script res://cases/preload_inner.gd holds the error: run script_check on it. " +
        "Fix it, then game_stop and game_start.",
      "res://cases/preload_outer.gd",
      4,
    ),
  );
  assert.equal(
    hint,
    `The game is paused at a script error and cannot continue, so waiting won't help: ${PRELOAD_REASON}, ` +
      "at res://cases/preload_outer.gd:4. " +
      "The preloaded script res://cases/preload_inner.gd holds the error: run script_check on it. " +
      "Fix it, then game_stop and game_start.",
    "a located break on a failed preload: the hint names the preloaded script after the file and line",
  );
}

{
  const hint = await errorBreakHintWith(
    logWithLocatedBreak(
      `Game paused at a script error it cannot continue from: ${PRELOAD_REASON}. ` +
        "Find the file and line with script_check or lsp_project_diagnostics, fix it, then game_stop and game_start.",
      "",
      0,
    ),
  );
  assert.equal(
    hint,
    `The game is paused at a script error and cannot continue, so waiting won't help: ${PRELOAD_REASON}. ` +
      "Fix it, then game_stop and game_start.",
    "an unlocated break on a failed preload: the hint without a location names no preloaded script",
  );
}

{
  const hint = await errorBreakHintWith(
    logWithLocatedBreak(
      "Game paused at a script error it cannot continue from: Parser Error: x, at res://other.gd:3, " +
        "at res://player.gd:12. Fix it, then game_stop and game_start.",
      "res://player.gd",
      12,
    ),
  );
  assert.equal(
    hint,
    "The game is paused at a script error and cannot continue, so waiting won't help: " +
      "Parser Error: x, at res://other.gd:3, at res://player.gd:12. Fix it, then game_stop and game_start.",
    "a located break whose reason names another file and line: the hint keeps the whole reason, then the entry's fields",
  );
}

// ── One re-read of an unlocated break entry, 500 ms after the first read ──

const LOCATED_BREAK =
  'Game paused at a script error it cannot continue from: Parser Error: Identifier "speed" not declared in the current scope, ' +
  "at res://player.gd:12. Fix it, then game_stop and game_start.";
const LOCATED_HINT =
  "The game is paused at a script error and cannot continue, so waiting won't help: " +
  'Parser Error: Identifier "speed" not declared in the current scope, at res://player.gd:12. ' +
  "Fix it, then game_stop and game_start.";

{
  const clock = FakeTimers.install({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const launch = launchAndWait({
      debugStates: [ERROR_BREAK],
      log: logWithBreaks(BREAK_WITH_REASON),
      reread: logWithLocatedBreak(LOCATED_BREAK, "res://player.gd", 12),
    });
    await clock.tickAsync(2_000);
    assert.equal(
      launch.payload()?.hint,
      LOCATED_HINT,
      "an unlocated first read and a located re-read: the hint carries the re-read's file and line",
    );
    await clock.tickAsync(5_000);
    assert.equal(callsTo(launch, "debugger.get_log"), 2, "a location that lands late: get_log is read twice, no more");
  } finally {
    clock.uninstall();
  }
}

{
  const clock = FakeTimers.install({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const launch = launchAndWait({
      debugStates: [ERROR_BREAK],
      log: logWithBreaks(BREAK_WITH_REASON),
      reread: logWithBreaks(BREAK_WITHOUT_REASON),
    });
    await clock.tickAsync(2_000);
    assert.equal(
      launch.payload()?.hint,
      ERROR_BREAK_HINT,
      "an entry still unlocated after the re-read: the first read's hint, with no location clause",
    );
    assert.equal(
      callsTo(launch, "debugger.get_log"),
      2,
      "an entry still unlocated after the re-read: two get_log reads",
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
      log: logWithLocatedBreak(LOCATED_BREAK, "res://player.gd", 12),
      reread: logWithBreaks(BREAK_WITHOUT_REASON),
    });
    await clock.tickAsync(2_000);
    assert.equal(launch.payload()?.hint, LOCATED_HINT, "a located first read: the hint carries its file and line");
    assert.equal(callsTo(launch, "debugger.get_log"), 1, "a located first read: no re-read");
  } finally {
    clock.uninstall();
  }
}

{
  const clock = FakeTimers.install({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    // The first get_log answer lands at 10.5 s, past the 10 s runtime-wait deadline.
    const launch = launchAndWait({
      debugStates: [ERROR_BREAK],
      log: logWithBreaks(BREAK_WITH_REASON),
      reread: logWithLocatedBreak(LOCATED_BREAK, "res://player.gd", 12),
      logDelayMs: 10_000,
    });
    await clock.tickAsync(11_000);
    assert.equal(
      launch.payload()?.hint,
      ERROR_BREAK_HINT,
      "an unlocated first read that ends past the runtime-wait deadline: the first read's hint stands",
    );
    assert.equal(callsTo(launch, "debugger.get_log"), 1, "an unlocated first read past the deadline: no re-read");
  } finally {
    clock.uninstall();
  }
}

{
  const clock = FakeTimers.install({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    // The first get_log answer lands at 9.8 s, before the 10 s deadline; the 500 ms wait for the re-read ends at 10.3 s.
    const launch = launchAndWait({
      debugStates: [ERROR_BREAK],
      log: logWithBreaks(BREAK_WITH_REASON),
      reread: logWithLocatedBreak(LOCATED_BREAK, "res://player.gd", 12),
      logDelayMs: 9_300,
    });
    await clock.tickAsync(11_000);
    assert.equal(
      launch.payload()?.hint,
      ERROR_BREAK_HINT,
      "a re-read whose 500 ms wait ends past the runtime-wait deadline: the first read's hint stands",
    );
    assert.equal(
      callsTo(launch, "debugger.get_log"),
      1,
      "a re-read whose 500 ms wait ends past the deadline: the re-read is not issued",
    );
  } finally {
    clock.uninstall();
  }
}

{
  const clock = FakeTimers.install({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    // The first get_log answer lands at 10.5 s, past the 10 s deadline; a 500 ms wait for a re-read would end at 11 s.
    const launch = launchAndWait({
      debugStates: [ERROR_BREAK],
      log: logWithBreaks(BREAK_WITH_REASON),
      reread: logWithLocatedBreak(LOCATED_BREAK, "res://player.gd", 12),
      logDelayMs: 10_000,
    });
    await clock.tickAsync(10_600);
    assert.equal(
      launch.payload()?.hint,
      ERROR_BREAK_HINT,
      "an unlocated first read that ends past the deadline: game_start answers at once, without the 500 ms wait",
    );
  } finally {
    clock.uninstall();
  }
}

console.log("All 30 tests passed.");
