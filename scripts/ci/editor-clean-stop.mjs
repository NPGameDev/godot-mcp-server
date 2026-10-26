// scripts/ci/editor-clean-stop.mjs
// The two bridge calls of the cross-version composite's editor stop, both through the
// toolkit's editor-channel `execute.code`, which evaluates an Expression against a Node
// in the editor tree with non-const calls allowed:
//   • `--sentinel <text>` runs `printerr("<text>")` twice, as two calls. The text goes to
//     the editor's own stderr, so editor.log is complete only if it holds the text after
//     the editor exits. Godot 4.2 on Windows block-buffers stderr redirected to a file,
//     and a forced kill loses the unflushed tail; the sentinel is the last write, so a
//     lost tail loses it. A buffer boundary can also fall inside one copy, with stdout
//     written between its halves; the other copy is then still whole.
//   • `--quit` runs `get_tree().quit()`. The main loop ends after the current frame and
//     the engine exits normally, which flushes stderr. The editor may close the socket
//     before the response leaves it, so a dropped connection (DISCONNECTED) or a call
//     timeout (TIMEOUT) counts as accepted. The composite still waits for the process
//     and kills it if it lingers.
//
// Usage: node scripts/ci/editor-clean-stop.mjs --sentinel <text> | --quit
// Env: GODOT_MCP_PROJECT_PATH (registry token lookup), GODOT_MCP_EDITOR_PORT (default 6550).
// It imports the built bridge from dist/, so it runs after `npm run build`.
// Prints one verdict line for the composite: `sentinel=sent|unsent|failed (…)` or
// `quit_request=accepted|failed (…)`. Exit codes: 0 sent or accepted · 1 unsent or
// failed · 2 bad arguments.
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The sentinel lands inside a GDScript string literal, so it is kept to word characters.
const SENTINEL_TEXT = /^\w+$/;
const SENTINEL_COPIES = 2;
// Errors that mean the editor could not be reached or stopped answering. Any other error
// means an editor that answered and refused, or a broken stop script, which the check
// must not excuse as an unreachable editor.
const UNREACHABLE_ERRORS = new Set(["CONNECT_FAILED", "DISCONNECTED", "TIMEOUT"]);
// Errors that mean the editor went away while answering the quit, which is the goal.
const QUIT_ACCEPTED_ERRORS = new Set(["DISCONNECTED", "TIMEOUT"]);

/**
 * The `execute.code` bodies that print the sentinel, one call each.
 *
 * @param sentinel - the sentinel text, word characters only.
 * @returns one `printerr` expression per copy.
 */
export function sentinelCalls(sentinel) {
  return Array.from({ length: SENTINEL_COPIES }, () => `printerr("${sentinel}")`);
}

/**
 * The verdict line the composite reads after the sentinel calls.
 *
 * @param copiesSent - how many sentinel copies the editor took before any error.
 * @param error - the error that stopped the calls, if one did; its `code` is the bridge
 *   error code.
 * @returns `sentinel=sent (…)` when the editor took any copy; `sentinel=unsent (…)` when
 *   it took none because it was unreachable or stopped answering, which the check only
 *   warns on; otherwise `sentinel=failed (…)`, naming the error code, which the check
 *   fails on.
 */
export function sentinelVerdict(copiesSent, error) {
  if (copiesSent > 0) return `sentinel=sent (${copiesSent} of ${SENTINEL_COPIES} copies)`;
  const code = error?.code ?? "unknown";
  const detail = `${code}: ${error?.message ?? error}`;
  return UNREACHABLE_ERRORS.has(code) ? `sentinel=unsent (${detail})` : `sentinel=failed (${detail})`;
}

function quitVerdict(error) {
  const code = error?.code ?? "unknown";
  return QUIT_ACCEPTED_ERRORS.has(code)
    ? `quit_request=accepted (connection dropped: ${code})`
    : `quit_request=failed (${code}: ${error?.message ?? error})`;
}

async function main(argv) {
  const [mode, sentinel] = argv;
  const quit = mode === "--quit";
  if (!quit && !(mode === "--sentinel" && sentinel && SENTINEL_TEXT.test(sentinel))) {
    console.error("usage: editor-clean-stop.mjs --sentinel <letters, digits, _> | --quit");
    return 2;
  }
  let bridge;
  let copiesSent = 0;
  try {
    // Imported here so a missing dist/ ends as a failed verdict naming the error, and the
    // unit tests load this module without a build.
    const { createBridge } = await import("../../dist/transport/bridge.js");
    const port = Number(process.env.GODOT_MCP_EDITOR_PORT || 6550);
    bridge = createBridge(`ws://127.0.0.1:${port}`, {
      projectPath: process.env.GODOT_MCP_PROJECT_PATH,
      explicitEditorPort: Boolean(process.env.GODOT_MCP_EDITOR_PORT),
    });
    if (quit) {
      await bridge.call("execute.code", { code: "get_tree().quit()" }, 10000);
      console.log("quit_request=accepted (response received)");
      return 0;
    }
    for (const code of sentinelCalls(sentinel)) {
      await bridge.call("execute.code", { code }, 15000);
      copiesSent++;
    }
    console.log(sentinelVerdict(copiesSent, undefined));
    return 0;
  } catch (err) {
    const verdict = quit ? quitVerdict(err) : sentinelVerdict(copiesSent, err);
    console.log(verdict);
    return /^(quit_request=accepted|sentinel=sent)/.test(verdict) ? 0 : 1;
  } finally {
    // close() must not hang on a socket the exiting editor already dropped.
    if (bridge) await Promise.race([bridge.close(), new Promise((resolve) => setTimeout(resolve, 3000))]);
  }
}

// Real paths on both sides, so a symlinked checkout still runs the calls.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  // exit() rather than exitCode: the bridge's reconnect timers would keep the process up.
  void main(process.argv.slice(2)).then((code) => process.exit(code));
}
