// scripts/ci/editor-wait-scene.mjs
// The cross-version composite's wait for an edited scene, run once the editor serves its
// WS port. The toolkit starts listening inside the editor's first filesystem scan, and the
// project's main scene opens only when that scan ends, so for some seconds after the port
// is up `scene.get_tree` answers NO_SCENE. The smoke's first section needs the scene, so
// this script calls `scene.get_tree` until it returns one or the bound runs out.
//
// Usage: node scripts/ci/editor-wait-scene.mjs [--timeout-ms <ms>]
// Env: GODOT_MCP_PROJECT_PATH (registry token lookup), GODOT_MCP_EDITOR_PORT (default 6550).
// It imports the built bridge from dist/, so it runs after `npm run build`.
// Prints one verdict line for the composite: `scene_wait=ready (…)` or
// `scene_wait=timeout (…)`, both with the wait in ms, or `scene_wait=failed (…)` when the
// wait could not run. Exit codes: 0 ready · 1 timeout or failed · 2 bad arguments.
import { realpathSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const DEFAULT_TIMEOUT_MS = 60000;
const POLL_INTERVAL_MS = 250;
// One call may not outlast the bound, and an editor busy in its scan can hold a reply
// for seconds; this caps how long one call may take.
const CALL_TIMEOUT_MS = 10000;

/**
 * What one `scene.get_tree` reply or call error says about the edited scene.
 *
 * @param reply - the call's result, when the call returned one.
 * @param error - the error the call threw, when it threw; its `code` is the bridge error
 *   code.
 * @returns `"ready"` when the reply carries the scene's `tree` string; otherwise the
 *   reason there is none yet: the reply's error code (NO_SCENE while the first scan runs),
 *   the call error's code, or `unexpected reply`.
 */
export function sceneState(reply, error) {
  if (error !== undefined) return error.code ?? `unknown error: ${error.message ?? error}`;
  if (reply === null || typeof reply !== "object") return "unexpected reply";
  if (typeof reply.code === "string") return reply.code;
  return typeof reply.tree === "string" ? "ready" : "unexpected reply";
}

/**
 * Call `scene.get_tree` until it returns an edited scene or the bound runs out. A call
 * that fails is retried like a NO_SCENE reply, since an editor still in its first scan
 * can drop or time out a connection.
 *
 * @param getTree - one `scene.get_tree` call; its argument is the call's timeout in ms.
 * @param opts - `timeoutMs`, the bound; `intervalMs`, the pause between calls; `now`,
 *   the clock in ms; `pause`, the wait between calls.
 * @returns whether a scene arrived, the ms waited, the calls made, and the first and
 *   last states {@link sceneState} gave.
 */
export async function waitForScene(getTree, opts) {
  const { timeoutMs, intervalMs, now, pause } = opts;
  const start = now();
  const deadline = start + timeoutMs;
  let calls = 0;
  let first;
  let last;
  while (now() < deadline) {
    let reply;
    let error;
    calls++;
    try {
      reply = await getTree(Math.max(1, Math.min(CALL_TIMEOUT_MS, deadline - now())));
    } catch (err) {
      error = err ?? new Error("call rejected without a reason");
    }
    last = sceneState(reply, error);
    first ??= last;
    if (last === "ready") return { ready: true, waitedMs: now() - start, calls, first, last };
    const left = deadline - now();
    if (left <= 0) break;
    await pause(Math.min(intervalMs, left));
  }
  return { ready: false, waitedMs: now() - start, calls, first, last };
}

/**
 * The verdict line the composite prints and reads.
 *
 * @param result - what {@link waitForScene} returned.
 * @param timeoutMs - the bound the wait ran under.
 * @returns `scene_wait=ready (…)` with the wait in ms and the first reply, or
 *   `scene_wait=timeout (…)` with the bound and the last reply.
 */
export function waitVerdict(result, timeoutMs) {
  const tally = `${result.calls} call${result.calls === 1 ? "" : "s"}`;
  if (result.ready) {
    return `scene_wait=ready (edited scene after ${result.waitedMs} ms, ${tally}, first reply ${result.first})`;
  }
  return (
    `scene_wait=timeout (no edited scene after ${result.waitedMs} ms of ${timeoutMs} ms, ${tally}, ` +
    `last reply ${result.last ?? "none"})`
  );
}

function parseTimeout(argv) {
  if (argv.length === 0) return DEFAULT_TIMEOUT_MS;
  const ms = Number(argv[1]);
  return argv.length === 2 && argv[0] === "--timeout-ms" && Number.isInteger(ms) && ms > 0 ? ms : undefined;
}

async function main(argv) {
  const timeoutMs = parseTimeout(argv);
  if (timeoutMs === undefined) {
    console.error("usage: editor-wait-scene.mjs [--timeout-ms <positive integer>]");
    return 2;
  }
  let bridge;
  try {
    const { createBridge } = await import("../../dist/transport/bridge.js");
    const port = Number(process.env.GODOT_MCP_EDITOR_PORT || 6550);
    bridge = createBridge(`ws://127.0.0.1:${port}`, {
      projectPath: process.env.GODOT_MCP_PROJECT_PATH,
      explicitEditorPort: Boolean(process.env.GODOT_MCP_EDITOR_PORT),
    });
    const result = await waitForScene((callTimeoutMs) => bridge.call("scene.get_tree", null, callTimeoutMs), {
      timeoutMs,
      intervalMs: POLL_INTERVAL_MS,
      now: () => Math.round(performance.now()),
      pause: (ms) => sleep(ms),
    });
    console.log(waitVerdict(result, timeoutMs));
    return result.ready ? 0 : 1;
  } catch (err) {
    console.log(`scene_wait=failed (${err?.code ?? "unknown"}: ${err?.message ?? err})`);
    return 1;
  } finally {
    // close() must not hang on a socket the editor already dropped.
    if (bridge) await Promise.race([bridge.close(), sleep(3000)]);
  }
}

// Real paths on both sides, so a symlinked checkout still runs the wait.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  // exit() rather than exitCode: the bridge's reconnect timers would keep the process up.
  void main(process.argv.slice(2)).then((code) => process.exit(code));
}
