import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef, ToolTextResult } from "../shared/types.js";
import { registerTools } from "../registration/toolRegistry.js";
import { callAndWrap } from "../registration/toolDispatch.js";
import { coercedBoolean } from "../shared/schemaCoercion.js";
import { isGroupLoaded } from "../groups/groupState.js";

const RUNTIME_WAIT_MS = 10_000;
// How often the runtime wait asks the editor whether its debugger stopped the
// game. A stopped game cannot connect its runtime while it is stopped, so without
// the check the wait would run out its full deadline and blame a slow start.
const BREAK_POLL_MS = 500;
// The same bound the debugger tools give an editor-side read.
const EDITOR_READ_TIMEOUT_MS = 5_000;

const TIMEOUT_HINT =
  "Game launched but runtime did not connect within 10s. " +
  "Follow up with game_start(if_running:'return', runtime_poll:true) " +
  "to retry, or check editor_get_console for startup errors.";
const BREAKPOINT_HINT = "The game is paused at a breakpoint; call debug_continue to resume.";
// The engine's GDScript analyzer words a failed script preload this way on 4.2 to 4.7.
// The game breaks on the line of the preload, so the error to fix is in the script it names.
const PRELOAD_FAILURE = /Could not preload resource script "(.+)"/s;

/** How a runtime wait ended: the runtime connected, or the hint that says why it did not. */
type RuntimeWaitOutcome = { kind: "connected"; port: number } | { kind: "not_connected"; hint: string };

/** The editor debugger's hold on the game: an error break cannot continue, a breakpoint pause can. */
type DebuggerStop = "error_break" | "breakpoint_pause" | "none";

export const playtestTools: ToolDef[] = [
  {
    name: "game_start",
    method: "game.start",
    description:
      "Start playtest. Blocks until runtime is ready by default; wait_for_runtime:false launches without blocking. scene_path:'main'|'current'(default)|res://path. if_running:'return' for idempotent mode.",
    inputSchema: {
      scene_path: z.string().optional(),
      wait_for_runtime: coercedBoolean()
        .default(true)
        .describe(
          "Defaults true — blocks until runtime connects (or times out) so runtime tools are immediately available. Pass wait_for_runtime:false to launch without blocking.",
        ),
      runtime_poll: coercedBoolean()
        .optional()
        .describe(
          "With if_running:'return', re-check whether the already-running game's runtime has since connected. Default false.",
        ),
      if_running: z.enum(["return", "fail"]).optional(),
    },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
  },
  {
    name: "game_stop",
    method: "game.stop",
    description:
      "Stop the currently-playing scene (idempotent — returns was_running:false if nothing was running). No params.",
    inputSchema: {},
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  },
];

export function register(server: McpServer, bridge: Bridge, allowedTools?: Set<string>): void {
  const handlers = new Map<string, (input: Record<string, unknown>) => Promise<ToolTextResult>>();
  handlers.set("game_start", async (input) => {
    const result = await callAndWrap(bridge, "game.start", input);
    // Inject hint if game started successfully and runtime group not loaded.
    if (!isGroupLoaded("runtime") && result.content?.[0]?.type === "text") {
      try {
        const payload = JSON.parse(result.content[0].text);
        if (payload.success && !result.isError) {
          payload.group_hint =
            "Game started. To interact with the running game, call " +
            "discover_tools({request: 'runtime'}) to access runtime tools.";
          result.content[0].text = JSON.stringify(payload);
        }
      } catch {
        /* parse failure — pass through unchanged */
      }
    }
    // Nudge: the caller opted out of blocking (wait_for_runtime:false) but the
    // runtime isn't ready yet — point them at the blocking and polling paths.
    // The toolkit sends its own nudge on this path, so the server's is only a
    // fallback when the toolkit sent no hint; appending would repeat the advice.
    if (!input.wait_for_runtime && result.content?.[0]?.type === "text" && !result.isError) {
      try {
        const payload = JSON.parse(result.content[0].text);
        if (payload.success && payload.runtime_ready === false && !hasHint(payload.hint)) {
          payload.hint =
            "runtime_ready is false — runtime tools are not yet available. " +
            "Call game_start with wait_for_runtime:true to block until ready, " +
            "or poll with game_start(if_running:'return', runtime_poll:true).";
          result.content[0].text = JSON.stringify(payload);
        }
      } catch {
        /* parse failure — pass through unchanged */
      }
    }
    // Server-side wait-for-runtime: absorb the async gap so agents get
    // single-call game launch instead of a two-step dance.
    if (input.wait_for_runtime && result.content?.[0]?.type === "text" && !result.isError) {
      try {
        const payload = JSON.parse(result.content[0].text);
        if (payload.runtime_discovery === "bridge" && bridge.waitForRuntimeConnection) {
          const outcome = await waitForRuntimeOrStop(bridge, bridge.waitForRuntimeConnection(RUNTIME_WAIT_MS));
          if (outcome.kind === "connected") {
            // Success — merge runtime info, drop the bridge-discovery marker.
            payload.runtime_ready = true;
            payload.runtime_port = outcome.port;
            delete payload.runtime_discovery;
            delete payload.hint;
          } else {
            // The toolkit leaves out its own runtime-wait guidance when
            // wait_for_runtime=true, so the agent needs guidance here.
            payload.hint = withServerHint(payload.hint, outcome.hint);
          }
          result.content[0].text = JSON.stringify(payload);
        }
      } catch {
        /* parse failure or a failed runtime wait — pass through unchanged */
      }
    }
    return result;
  });
  registerTools(server, bridge, playtestTools, allowedTools, { handlers });
}

// The toolkit's hint can say why the runtime is not ready (a runtime opt-out in
// the editor's environment), which the server's generic guidance cannot, so the
// server never replaces it.
function hasHint(hint: unknown): hint is string {
  return typeof hint === "string" && hint !== "";
}

// Keeps the toolkit's hint first and appends the server's after one space, in the
// one `hint` string.
function withServerHint(toolkitHint: unknown, serverHint: string): string {
  return hasHint(toolkitHint) ? `${toolkitHint} ${serverHint}` : serverHint;
}

/**
 * Races the runtime wait against the editor's debugger state, polled every
 * {@link BREAK_POLL_MS}. A game the debugger stopped cannot connect while it is
 * stopped, so a stop ends the wait at once with a hint naming it. The poll ends
 * when the race does, and a rejected wait rejects the race.
 */
function waitForRuntimeOrStop(
  bridge: Bridge,
  runtimeWait: Promise<{ port: number } | undefined>,
): Promise<RuntimeWaitOutcome> {
  return new Promise<RuntimeWaitOutcome>((resolve, reject) => {
    let decided = false;
    // The runtime wait settles at its deadline at the latest, so once it has, an
    // error break's re-read would hold game_start past that deadline.
    let waitOver = false;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    // The first side to call this decides the race; it stops the poll and
    // returns false to every later caller.
    const decide = (): boolean => {
      if (decided) return false;
      decided = true;
      clearTimeout(pollTimer);
      return true;
    };
    const schedulePoll = (): void => {
      pollTimer = setTimeout(() => void poll(), BREAK_POLL_MS);
      pollTimer.unref?.();
    };
    // Never rejects: both editor reads turn their failures into "no answer".
    const poll = async (): Promise<void> => {
      const stop = await readDebuggerStop(bridge);
      if (decided) return;
      if (stop === "none") {
        schedulePoll();
        return;
      }
      // Decide on the stop before reading its reason, so a runtime-wait
      // deadline that passes during the read cannot answer with the timeout hint.
      decide();
      const hint =
        stop === "error_break" ? errorBreakHint(await readLocatedErrorBreak(bridge, () => waitOver)) : BREAKPOINT_HINT;
      resolve({ kind: "not_connected", hint });
    };
    runtimeWait.then(
      (runtime) => {
        waitOver = true;
        if (decide()) {
          resolve(runtime ? { kind: "connected", port: runtime.port } : { kind: "not_connected", hint: TIMEOUT_HINT });
        }
      },
      (err: unknown) => {
        waitOver = true;
        if (decide()) reject(err);
      },
    );
    schedulePoll();
  });
}

/** Reads the editor's `debug.state`. A failed read counts as no stop, so the wait goes on. */
async function readDebuggerStop(bridge: Bridge): Promise<DebuggerStop> {
  try {
    const state = (await bridge.call("debug.state", {}, EDITOR_READ_TIMEOUT_MS)) as {
      breaked?: unknown;
      can_debug?: unknown;
    } | null;
    if (state?.breaked !== true) return "none";
    if (state.can_debug === false) return "error_break";
    return state.can_debug === true ? "breakpoint_pause" : "none";
  } catch {
    // One missed poll only delays the check; the next one asks again.
    return "none";
  }
}

/** What the editor knew about an error break; each part is undefined when it did not have it. */
interface ErrorBreak {
  /** The editor debugger's text for the error. */
  reason?: string;
  /** Where the game stopped, as `<file>:<line>`. */
  location?: string;
}

/**
 * Reads the error behind an error break from the latest `break` entry of the
 * editor-side `debugger.get_log`. The location comes from the entry's `source`
 * and `line` fields, which an empty source or a line of 0 leaves unknown. The
 * reason is the clause the toolkit puts between "continue from: " and the rest
 * of its sentence (see {@link breakReasonPattern}), undefined when the entry has
 * no such clause. Returns undefined when the buffer holds no `break` entry (the
 * toolkit replaces it with `log_scan` entries when the log shows the error) or
 * when the read fails; the hint then goes out without a reason or a location.
 */
async function readErrorBreak(bridge: Bridge): Promise<ErrorBreak | undefined> {
  try {
    const page = (await bridge.call("debugger.get_log", {}, EDITOR_READ_TIMEOUT_MS)) as {
      error_buffer?: unknown;
    } | null;
    const entries = Array.isArray(page?.error_buffer) ? (page.error_buffer as unknown[]) : [];
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i] as { type?: unknown; message?: unknown; source?: unknown; line?: unknown } | null;
      if (entry?.type === "break" && typeof entry.message === "string") {
        const { source, line } = entry;
        const location =
          typeof source === "string" && source !== "" && typeof line === "number" && line > 0
            ? `${source}:${line}`
            : undefined;
        return { reason: entry.message.match(breakReasonPattern(location))?.[1], location };
      }
    }
    return undefined;
  } catch {
    // The reason and location only enrich the hint; the stop itself is already known.
    return undefined;
  }
}

/**
 * Reads the error break with {@link readErrorBreak}, and reads it once more,
 * one {@link BREAK_POLL_MS} later, when the first read finds a `break` entry with
 * no location: the toolkit fills the location from the stack dump the editor's
 * debugger sends after the break, which can land just after the first read. The
 * re-read is skipped once `waitOver()` says the runtime wait has ended, so it is
 * never issued past the wait's deadline. The first read stands unless the re-read
 * finds the location.
 */
async function readLocatedErrorBreak(bridge: Bridge, waitOver: () => boolean): Promise<ErrorBreak> {
  const first = await readErrorBreak(bridge);
  if (first === undefined || first.location !== undefined || waitOver()) return first ?? {};
  await new Promise<void>((resolve) => {
    setTimeout(resolve, BREAK_POLL_MS).unref?.();
  });
  if (waitOver()) return first;
  const reread = await readErrorBreak(bridge);
  return reread?.location !== undefined ? reread : first;
}

/**
 * Matches the toolkit's text for an error break and captures its reason. The
 * reason runs from "continue from: " to the sentence's ending, matched to the end
 * of the message since the error text can hold the same words: with a location,
 * ", at <location>.", an optional sentence naming a preloaded script, and
 * " Fix it, …"; without one, "." and then " Fix it, …" or the " Find the file
 * and line …" advice the toolkit gives when it has no location.
 */
function breakReasonPattern(location: string | undefined): RegExp {
  const at = location === undefined ? "" : `, at ${escapeRegExp(location)}`;
  return new RegExp(
    `continue from: (.+?)${at}\\.(?: The preloaded script .+ holds the error: run script_check on it\\.)?` +
      " (?:Find the file and line with script_check or lsp_project_diagnostics, fix it|Fix it)" +
      ", then game_stop and game_start\\.$",
    "s",
  );
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The hint for an error break, with the error text and the file and line when
 * the editor had them, and the preloaded script to fix when the error is a
 * failed preload. The text matches the toolkit's own `game_start` hint.
 */
function errorBreakHint({ reason, location }: ErrorBreak): string {
  const because = reason === undefined ? "" : `: ${reason}`;
  let where = ".";
  if (location !== undefined) {
    where = `, at ${location}.`;
    const preloaded = reason?.match(PRELOAD_FAILURE)?.[1];
    if (preloaded !== undefined) {
      where += ` The preloaded script ${preloaded} holds the error: run script_check on it.`;
    }
  }
  return (
    `The game is paused at a script error and cannot continue, so waiting won't help${because}${where} ` +
    "Fix it, then game_stop and game_start."
  );
}
