/**
 * Process lifecycle — how the bridge process ends.
 *
 * A stdio MCP server has exactly one client, and that client rarely says goodbye:
 * it closes its end of our pipes and sends no signal. The handlers here turn those
 * pipe events into one bounded departure shutdown:
 *
 *   stdin end / close   → client departed        → departure shutdown, exit 0
 *   stdout 'error'      → transport dead          → departure shutdown, exit 0
 *   stderr 'error'      → diagnostics gone, mute  → keep serving
 *   SIGINT / SIGTERM    → signalled stop          → departure shutdown, exit 0
 *
 * unhandledRejection / uncaughtException log and keep the process alive (code
 * standards §7.6). They never exit on an error code: with the stream listeners
 * installed, no stdio failure can reach them, so whatever does is another peer's
 * socket, not our client.
 *
 * stdin is the primary detector, not a backup: an open editor WebSocket is a ref'd
 * handle, so EOF never drains the loop on its own. The stderr rule exists because
 * before 1.0.1 the crash handler logged EPIPE to the very stderr that had raised
 * it, re-entered itself on every tick, and pinned a core at 100% for as long as
 * the orphan lived (#2).
 */
import type { Bridge } from "../shared/types.js";

/** Upper bound on the graceful close. A frozen editor makes the WebSocket close
 *  handshake wait for ws's 30 s timeout; a departing server exits well before that. */
export const SHUTDOWN_DEADLINE_MS = 2_000;

/** Write a diagnostic line without ever throwing. A file-backed stderr can throw
 *  synchronously; a pipe-backed one reports failure through its 'error' event, which
 *  the muted listener in installProcessHandlers absorbs. Either way the caller continues. */
export function logSafely(line: string): void {
  try {
    process.stderr.write(line);
  } catch {
    // The diagnostics sink is unusable; dropping the line is the only safe option.
  }
}

/** Install the departure shutdown (stdin EOF, dead stdout, SIGINT/SIGTERM → await
 *  bridge.close bounded by SHUTDOWN_DEADLINE_MS → exit 0), the muted stderr listener,
 *  and the unhandledRejection / uncaughtException loggers that keep the bridge alive. */
export function installProcessHandlers(bridge: Bridge): void {
  let shuttingDown = false;

  // The single exit path. First trigger wins: a dying client can deliver stdin EOF, a
  // stream error and a signal within one tick, and bridge.close() must run once. The
  // close races the deadline so a hung peer can never keep a departed server alive.
  // Always exit 0: the server ended because its job ended, not because it failed.
  function departureShutdown(reason: string): void {
    if (shuttingDown) return;
    shuttingDown = true;
    logSafely(`[godot-mcp] shutting down: ${reason}\n`);
    const deadline = setTimeout(() => process.exit(0), SHUTDOWN_DEADLINE_MS);
    deadline.unref();
    void bridge.close().then(
      () => process.exit(0),
      () => process.exit(0),
    );
  }

  process.on("SIGINT", () => departureShutdown("SIGINT"));
  process.on("SIGTERM", () => departureShutdown("SIGTERM"));

  // Client departure: the client closed its end of our stdin. Fires whether or not we
  // ever write again, and it is the only signal that fires while an editor socket keeps
  // the event loop alive.
  process.stdin.on("end", () => departureShutdown("stdin closed by the client"));
  process.stdin.on("close", () => departureShutdown("stdin closed"));

  // Transport dead: any stdout failure means no response can reach the client — not
  // tied to one error code on purpose (an unlisted code would leave a zombie).
  process.stdout.on("error", (err: NodeJS.ErrnoException) => {
    departureShutdown(`stdout unwritable (${err?.code ?? err?.message ?? "unknown"})`);
  });

  // Diagnostics gone: swallow. The listener's presence is the fix — an 'error' with
  // no listener is thrown, lands in uncaughtException, gets logged to the same dead
  // stderr, and so on forever. Nothing can be logged about a dead log sink.
  process.stderr.on("error", () => {
    /* muted */
  });

  // Stray errors never end the process (§7.6). Logging goes through logSafely so a
  // dead stderr cannot re-enter these handlers.
  process.on("unhandledRejection", (reason) => {
    logSafely(`[godot-mcp] unhandledRejection: ${String(reason)}\n`);
  });
  process.on("uncaughtException", (err) => {
    logSafely(`[godot-mcp] uncaughtException: ${err?.stack ?? err}\n`);
  });
}
