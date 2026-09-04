/**
 * Process lifecycle — the signal, transport-EOF, and crash handlers that decide
 * when the bridge process lives and when it exits.
 *
 * SIGINT/SIGTERM trigger a graceful shutdown (close the bridge, then exit 0), and
 * so does end-of-input on stdin: an stdio server whose client has closed the pipe
 * has nobody left to serve, and no signal is guaranteed to arrive when a client
 * dies abruptly. The unhandledRejection / uncaughtException handlers log to stderr
 * and deliberately keep the bridge running, so a stray rejection never tears the
 * server down — with one carve-out for a broken stdio pipe, where "stay alive"
 * would mean spinning forever against a sink that can no longer accept a byte.
 */
import type { Bridge } from "../shared/types.js";

/** Error codes that mean the stdio pipe to the client is gone for good. */
const BROKEN_PIPE_CODES = new Set(["EPIPE", "ERR_STREAM_DESTROYED", "ERR_STREAM_WRITE_AFTER_END"]);

function isBrokenPipe(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return code !== undefined && BROKEN_PIPE_CODES.has(code);
}

/** Write a diagnostic line without ever throwing: the sink we report failures to
 *  is itself a pipe that can be gone, and a throwing logger re-enters the very
 *  handler that called it. */
function logSafely(line: string): void {
  try {
    process.stderr.write(line);
  } catch {
    // The diagnostic channel is dead; dropping the line is the only option left.
    // The broken-pipe handlers below are what actually ends the process.
  }
}

/** Install SIGINT/SIGTERM + stdin-EOF graceful shutdown (await bridge.close → exit 0),
 *  the broken-pipe guards on the stdio streams, and the unhandledRejection /
 *  uncaughtException stderr loggers that keep the bridge alive. */
export function installProcessHandlers(bridge: Bridge): void {
  let shuttingDown = false;

  async function shutdown(): Promise<void> {
    // Re-entrant by nature: a dying client can deliver stdin EOF, a stream error,
    // and a signal within the same tick. First one through wins; the rest return
    // so bridge.close() is never raced against itself.
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await bridge.close();
    } finally {
      process.exit(0);
    }
  }

  /** Exit now, skipping the graceful close: reached only when the client's pipe is
   *  already broken, so there is no one left to shut down politely for, and every
   *  further write would fail the same way. */
  function exitOnBrokenPipe(): void {
    if (shuttingDown) return;
    shuttingDown = true;
    process.exit(0);
  }

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  // Client departure, the ordinary case: the MCP client closes the stdio pipes on
  // exit and sends no signal. Node would usually drain and exit here anyway, since
  // every long-lived handle in the bridge is unref()'d — but that exit is incidental,
  // and one future ref'd timer would turn it into a hang. Shutting down explicitly
  // makes it deliberate, and closes the bridge instead of merely dropping it.
  process.stdin.on("end", () => void shutdown());
  process.stdin.on("close", () => void shutdown());

  // A write to a pipe whose reader is gone raises EPIPE. Handling it on the stream
  // keeps it away from uncaughtException, where logging the failure would trigger
  // the identical failure and spin the event loop at 100% CPU.
  for (const stream of [process.stdout, process.stderr]) {
    stream.on("error", (err: unknown) => {
      if (isBrokenPipe(err)) exitOnBrokenPipe();
    });
  }

  // Prevent unhandled errors from crashing the bridge process.
  // Log to stderr for diagnostics; the bridge stays alive.
  process.on("unhandledRejection", (reason) => {
    if (isBrokenPipe(reason)) return exitOnBrokenPipe();
    logSafely(`[godot-mcp] unhandledRejection: ${reason}\n`);
  });
  process.on("uncaughtException", (err) => {
    if (isBrokenPipe(err)) return exitOnBrokenPipe();
    logSafely(`[godot-mcp] uncaughtException: ${err?.stack ?? err}\n`);
  });
}
