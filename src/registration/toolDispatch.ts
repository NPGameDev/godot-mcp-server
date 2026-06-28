/**
 * Tool dispatch — execute ONE tool call: route it to the bridge, normalize
 * the result into the canonical MCP error contract, and inject the
 * happy-path success hint. The per-call primitive that registration wires
 * every default tool's handler through; it knows nothing of registration
 * (no version gate, path guard, or hook pipeline — those wrap the handler
 * one layer above, in the registration core's wrappedHandler). A mid-tier module:
 * below registration, above the error/serialization leaves.
 */
import { stableStringify } from "../shared/schemaMin.js";
import { BridgeError } from "../shared/errors.js";
import {
  toolError,
  toolErrorFromPayload,
  toolErrorFromException,
  runtimeErrorWithCrashContext,
} from "../shared/errorContract.js";
import type { Bridge, ToolTextResult } from "../shared/types.js";

/**
 * Whether a success hint should be applied: the payload is a non-null
 * object with no existing hint. The server never overwrites a
 * toolkit-provided hint. Shared by both injection sites — the raw-object
 * path in callAndWrap (Site 1) and the parsed-text-block path in
 * injectSuccessHint (Site 2) — which keep their distinct serialization
 * steps; only this boolean decision is unified.
 */
function shouldApplySuccessHint(payload: unknown): payload is Record<string, unknown> {
  return !!payload && typeof payload === "object" && !(payload as Record<string, unknown>).hint;
}

// ── Shared call wrapper ─────────────────────────────────────────────

/**
 * Shared handler body for tools that do a single bridge call and
 * JSON-stringify the result. Centralises error-contract compliance:
 *   1. Try/catch around the bridge call — BridgeError becomes toolError.
 *   2. Result payload inspection — {success: false} becomes toolError.
 *   3. Happy path — JSON-stringified into a text content block.
 *
 * Screenshots and other multi-content handlers stay custom but use
 * toolError directly for their error branches.
 */
export async function callAndWrap(
  bridge: Bridge,
  method: string,
  input: unknown,
  opts: {
    runtime?: boolean;
    timeoutMs?: number;
    extensionTimeoutHint?: string;
    signal?: AbortSignal;
    successHint?: string;
  } = {},
): Promise<ToolTextResult> {
  try {
    const result = opts.runtime
      ? await bridge.callRuntime(method, input, opts.timeoutMs, opts.signal)
      : await bridge.call(method, input, opts.timeoutMs, opts.signal);
    const err = toolErrorFromPayload(result);
    if (err) return err;
    // Inject success hint if provided and toolkit didn't already set one
    if (opts.successHint && shouldApplySuccessHint(result)) result.hint = opts.successHint;
    return { content: [{ type: "text", text: stableStringify(result) }] };
  } catch (err) {
    if (opts.runtime) return runtimeErrorWithCrashContext(bridge, err);
    if (opts.extensionTimeoutHint && err instanceof BridgeError && err.code === "TIMEOUT") {
      return toolError("TIMEOUT", err.message, opts.extensionTimeoutHint);
    }
    return toolErrorFromException(err);
  }
}

// ── Success-hint injection (custom-handler path) ────────────────────

/** Inject a success hint into the first JSON text block of a ToolTextResult.
 *  Skips if the payload already has a toolkit-provided hint. */
export function injectSuccessHint(result: ToolTextResult, hint: string): void {
  for (const block of result.content) {
    if (block.type === "text") {
      try {
        const payload = JSON.parse(block.text);
        if (shouldApplySuccessHint(payload)) {
          payload.hint = hint;
          block.text = JSON.stringify(payload);
          return;
        }
      } catch {
        /* non-JSON text content — skip */
      }
    }
  }
}
