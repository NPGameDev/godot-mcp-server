/**
 * Error contract — shape every failure into the canonical MCP error
 * response with the right code and hint. A near-pure leaf: the runtime
 * crash-context helpers take the Bridge as a parameter, so this module
 * depends on neither registration nor dispatch.
 */
import { BridgeError } from "./errors.js";
import { PAGE_FIELD } from "./pagination.js";
import type { Bridge, ErrorCode, ToolTextResult } from "./types.js";

// ── Error utilities ─────────────────────────────────────────────────

/**
 * Canonical MCP failure response. Plugin emits
 * {success: false, error, code} inside the JSON-RPC result payload;
 * transport-level failures surface as BridgeError and are translated
 * here. String `code` is accepted (in addition to the ErrorCode union)
 * because bridge errors (RPC_ERROR etc.) aren't statically typed at
 * every call site.
 */
export function toolError(code: ErrorCode | string, message: string, hint?: string): ToolTextResult {
  const payload: Record<string, unknown> = { success: false, error: message, code };
  if (hint) payload.hint = hint;
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    isError: true,
  };
}

/**
 * If the plugin returned {success: false, ...} inside the JSON-RPC
 * result, translate it to an MCP isError response. Non-error successes
 * (including idempotent create returns) have success absent or
 * truthy and pass through unchanged.
 */
export function toolErrorFromPayload(result: unknown): ToolTextResult | undefined {
  if (!result || typeof result !== "object") return undefined;
  const obj = result as { success?: unknown; code?: unknown; error?: unknown; hint?: unknown };
  if (obj.success !== false) return undefined;
  const code = typeof obj.code === "string" ? obj.code : "INTERNAL";
  const error = typeof obj.error === "string" ? obj.error : "unknown error";
  const hint = typeof obj.hint === "string" ? obj.hint : undefined;
  return toolError(code, error, hint);
}

/**
 * Default hints for transport-level codes thrown as a `BridgeError`.
 *
 * Membership invariant: only codes that can arrive as a thrown `BridgeError`
 * (transport-level, where the toolkit never ran to attach a hint) belong here.
 * Application-level codes the toolkit emits as `{ success: false, … }` payloads
 * carry their own hint — do not add them: those flow through `toolErrorFromPayload`,
 * which relays the toolkit's hint verbatim, so the toolkit is the SSOT for their
 * wording. `LOG_BUSY` / `LOG_UNAVAILABLE` are such payload codes — their recovery
 * advice is version-gated on the editor's Godot version (only the toolkit knows it),
 * so a fixed server default would be stale for half the versions. `COMPILATION_FAILED`
 * stays: it is handled as a thrown code in `runtimeErrorWithCrashContext`.
 */
const EXCEPTION_HINTS: Record<string, string> = {
  TIMEOUT:
    "The editor or game may be busy, or the game failed to compile/start. " +
    "For editor calls, try editor.wait_for_idle. For runtime calls, " +
    "debugger_get_log returns cached output after a crash. If empty, call editor_get_console without level_filter.",
  COMPILATION_FAILED:
    "The game failed to compile. Fix the script errors listed above, then call game_start again. " +
    "If no errors are shown, call editor_refresh to retrigger them, then editor_get_console for the full log.",
  DISCONNECTED:
    "Plugin WebSocket not connected. Ensure Godot is running with the plugin enabled. If running headless, launch with: godot --headless --editor --path <project>",
  CONNECT_FAILED:
    "Could not connect to the Godot editor plugin. Ensure Godot is running with the plugin enabled. If running headless, launch with: godot --headless --editor --path <project>",
  GAME_NOT_RUNNING:
    "No running game. Call editor_get_console(level_filter:['error']) for crash diagnostics. " +
    "If empty, the game may have crashed — debugger_get_log serves cached output from log file after a real crash (OS signal). " +
    "To restart: fix the errors, then game_start.",
};

/**
 * Hint for a TIMEOUT that fired while the call sat in the toolkit's mutation
 * queue (serialized behind other mutations), not because anything stalled. The
 * generic EXCEPTION_HINTS.TIMEOUT "editor or game may be busy" advice is
 * actively misleading here — the call was healthy, just waiting its fair-FIFO
 * turn — so this replaces it and surfaces the duplicate-on-retry risk.
 */
const SERIALIZED_QUEUE_TIMEOUT_HINT =
  "The command was accepted and queued behind other scene mutations, then exceeded its timeout while waiting its turn. " +
  "Issue scene mutations sequentially rather than in parallel. A retry may re-apply an already-applied change — " +
  "re-check state before re-issuing (duplicate-on-retry risk).";

/**
 * Map a thrown BridgeError (or any Error) to a toolError response.
 * Preserves the bridge's transport-layer code (TIMEOUT, DISCONNECTED,
 * GAME_NOT_RUNNING, CONNECT_FAILED, ...) so the client-facing response
 * is specific enough to retry-or-give-up on.
 */
export function toolErrorFromException(err: unknown): ToolTextResult {
  const code = err instanceof BridgeError ? err.code : "INTERNAL";
  const message = (err as Error)?.message ?? String(err);
  const hint =
    err instanceof BridgeError && err.serializedQueueTimeout ? SERIALIZED_QUEUE_TIMEOUT_HINT : EXCEPTION_HINTS[code];
  return toolError(code, message, hint);
}

// ── Runtime crash context ───────────────────────────────────────────

/**
 * When a runtime call fails, try to auto-fetch recent errors from the
 * debugger bridge (game-session-specific errors + log file cache), with
 * fallback to editor_get_console for pre-game-start scenarios.
 */
async function fetchCrashContext(bridge: Bridge): Promise<string> {
  // Primary: debugger.get_log has error_buffer (debugger bridge) + log file lines.
  try {
    const result = (await bridge.call("debugger.get_log", { limit: 15 }, 5_000)) as Record<string, unknown>;
    const parts: string[] = [];
    const errorBuffer = Array.isArray(result?.error_buffer) ? result.error_buffer : [];
    for (const entry of errorBuffer) {
      const e = entry as Record<string, unknown>;
      const msg = typeof e.message === "string" ? e.message : "";
      const src = typeof e.source === "string" ? e.source : "";
      const line = typeof e.line === "number" ? e.line : 0;
      if (msg) {
        parts.push(src && line ? `${msg} (${src}:${line})` : msg);
      }
    }
    const lines = Array.isArray(result?.lines) ? result.lines : [];
    for (const line of lines) {
      parts.push(String(line));
    }
    if (parts.length > 0) return parts.join("\n");
  } catch {
    // debugger.get_log failed — fall through to editor_get_console
  }
  // Fallback: editor console (e.g., no game session was ever started).
  try {
    const result = (await bridge.call("editor.get_console", { limit: 15, level_filter: ["error"] }, 5_000)) as Record<
      string,
      unknown
    >;
    const returned = result?.[PAGE_FIELD.returned];
    if (typeof returned === "number" && returned === 0) return "";
    const entries = result?.entries;
    if (typeof entries === "string" && entries.length > 0) return entries;
  } catch {
    // Editor might be down too — fall through to generic hint
  }
  return "";
}

/**
 * Handle runtime errors (TIMEOUT / GAME_NOT_RUNNING) with auto-fetched
 * crash context from editor_get_console. Exported for custom handlers
 * (runtime_screenshot, debugger_get_log) that don't use callAndWrap.
 */
export async function runtimeErrorWithCrashContext(bridge: Bridge, err: unknown): Promise<ToolTextResult> {
  if (
    err instanceof BridgeError &&
    (err.code === "TIMEOUT" || err.code === "GAME_NOT_RUNNING" || err.code === "COMPILATION_FAILED")
  ) {
    const crashContext = await fetchCrashContext(bridge);
    if (crashContext) {
      return toolError(
        err.code,
        err.message,
        "Game crashed or failed to compile. Recent errors from editor console:\n" +
          crashContext +
          "\nFix the script errors, then game_stop + game_start to retry. " +
          "If errors are stale, call editor_refresh to retrigger them.",
      );
    }
  }
  return toolErrorFromException(err);
}
