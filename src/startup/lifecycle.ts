/**
 * Process lifecycle — the signal + crash handlers that keep the bridge process
 * alive.
 *
 * SIGINT/SIGTERM trigger a graceful shutdown (close the bridge, then exit 0).
 * The unhandledRejection / uncaughtException handlers log to stderr for
 * diagnostics but deliberately keep the bridge running, so a stray rejection
 * never tears the server down.
 */
import type { Bridge } from "../shared/types.js";

/** Install SIGINT/SIGTERM graceful shutdown (await bridge.close → exit 0) and the
 *  unhandledRejection / uncaughtException stderr loggers that keep the bridge alive. */
export function installProcessHandlers(bridge: Bridge): void {
  async function shutdown(): Promise<void> {
    try {
      await bridge.close();
    } finally {
      process.exit(0);
    }
  }
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  // Prevent unhandled errors from crashing the bridge process.
  // Log to stderr for diagnostics; the bridge stays alive.
  process.on("unhandledRejection", (reason) => {
    process.stderr.write(`[godot-mcp] unhandledRejection: ${reason}\n`);
  });
  process.on("uncaughtException", (err) => {
    process.stderr.write(`[godot-mcp] uncaughtException: ${err?.stack ?? err}\n`);
  });
}
