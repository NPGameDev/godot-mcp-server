import type { Bridge } from "../shared/types.js";

/**
 * How long the tools that read the editor's debugger give one editor-side read.
 * The bound starts once the editor channel is open: after an editor drop a read
 * first waits out the channel's reconnect ceiling and the bridge's editor
 * rediscovery.
 *
 * @internal Folder-internal to `tools/`, shared by the sibling tool modules
 * that read the editor's debugger; not part of the public surface.
 */
export const EDITOR_READ_TIMEOUT_MS = 5_000;

/**
 * The editor debugger's hold on the game: an error break cannot continue, a
 * breakpoint pause can, and `"none"` is no hold.
 *
 * @internal Folder-internal to `tools/`; not part of the public surface.
 */
export type DebuggerStop = "error_break" | "breakpoint_pause" | "none";

/**
 * Reads the editor's `debug.state` as a debugger stop: `breaked: true` is a
 * stop, a breakpoint pause when `can_debug` is `true` and an error break for
 * anything else (`false`, missing or not a boolean), so every stop counts as
 * one, even when the answer does not say which kind it is.
 *
 * @returns `"none"` when `breaked` is not `true`, when the answer is not an
 * object, and when the read fails. It never rejects; each caller documents why
 * a failed read is harmless there.
 *
 * @internal Folder-internal to `tools/`; not part of the public surface.
 */
export async function readDebuggerStop(bridge: Bridge): Promise<DebuggerStop> {
  let state: unknown;
  try {
    state = await bridge.call("debug.state", {}, EDITOR_READ_TIMEOUT_MS);
  } catch {
    // A failed read is no stop; see @returns.
    return "none";
  }
  if (typeof state !== "object" || state === null) return "none";
  const { breaked, can_debug: canDebug } = state as { breaked?: unknown; can_debug?: unknown };
  if (breaked !== true) return "none";
  return canDebug === true ? "breakpoint_pause" : "error_break";
}
