/**
 * Tool dispatch — execute ONE tool call: route it to the bridge, normalize
 * the result into the canonical MCP error contract, and inject the
 * happy-path success hint (resolved and wrapped around a handler in one
 * place, withSuccessHint). The per-call primitive that registration wires
 * every default tool's handler through; it knows nothing of registration
 * (no version gate, path guard, or hook pipeline — those wrap the handler
 * one layer above, in the registration core's wrappedHandler). A mid-tier module:
 * below registration, above the error/serialization leaves.
 */
import { stableStringify } from "../shared/stableJson.js";
import { BridgeError } from "../shared/errors.js";
import {
  toolError,
  toolErrorFromPayload,
  toolErrorFromException,
  runtimeErrorWithCrashContext,
} from "../shared/errorContract.js";
import type { Bridge, ToolDef, ToolTextResult } from "../shared/types.js";

/**
 * Whether a success hint should be applied: the payload is a non-null
 * object with no existing hint. The server never overwrites a
 * toolkit-provided hint. Shared by both injection sites — the raw-object
 * path in callAndWrap and the parsed-text-block path in injectSuccessHint —
 * which keep their distinct serialization
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

// ── Success-hint selection ──────────────────────────────────────────

/** The hint fields of a tool that {@link resolveSuccessHint} reads. */
export type SuccessHintSource = Pick<ToolDef, "successHint" | "operationHints" | "operationParam">;

/**
 * The success hint for one call of a tool: its per-operation hint when the
 * call's operation has one, otherwise its static successHint.
 *
 * @param def - the tool's hint fields and the name of its operation argument
 * @param input - the call's arguments
 * @returns the hint to inject, or `undefined` for none
 */
export function resolveSuccessHint(def: SuccessHintSource, input: unknown): string | undefined {
  if (def.operationHints && def.operationParam && input && typeof input === "object") {
    const operation = (input as Record<string, unknown>)[def.operationParam];
    if (typeof operation === "string" && Object.hasOwn(def.operationHints, operation)) {
      return def.operationHints[operation];
    }
  }
  return def.successHint;
}

// ── Success-hint wrapping ───────────────────────────────────────────

/** A tool handler as registration calls it: the call's arguments and its cancellation signal. */
export type ToolCallHandler = (input: unknown, signal?: AbortSignal) => Promise<ToolTextResult>;

/**
 * A tool handler that also receives its call's success-hint resolver and
 * attaches the hint itself. The resolver returns the hint, or `undefined` when
 * the call has none; the handler calls it at the point its path reads the hint.
 */
export type HintedToolHandler = (
  input: unknown,
  signal: AbortSignal | undefined,
  resolveHint: () => string | undefined,
) => Promise<ToolTextResult>;

/**
 * Wrap a tool handler with the success-hint rule: each call's hint is
 * {@link resolveSuccessHint} of `def` and the call's arguments object.
 *
 * @remarks
 * The hint is resolved when the handler calls its resolver, not when the
 * wrapper is entered: a {@link callAndWrap} handler resolves it before the
 * bridge call, and {@link injectHintAfterCall} resolves it after the handler
 * returns. The resolver reads the same arguments object the handler received,
 * so a handler that rewrites an operation field changes the hint picked after
 * its call.
 *
 * @param def - the hint fields that apply on this path; a path that does not
 *   inject a hint field passes a view without it
 * @param handler - attaches the hint: a {@link callAndWrap} handler passes the
 *   resolved hint as `successHint`, so it lands in the payload before serialization; a handler that
 *   builds its own response goes through {@link injectHintAfterCall}
 * @returns the handler registration calls
 */
export function withSuccessHint(def: SuccessHintSource, handler: HintedToolHandler): ToolCallHandler {
  return (input, signal) => handler(input, signal, () => resolveSuccessHint(def, input));
}

/**
 * Adapt a handler that builds its own response (custom shaping, the LSP client)
 * to {@link withSuccessHint}: the hint is resolved after the handler returns,
 * and after a call that is not an error result it goes into the first JSON text
 * block of the response.
 *
 * @param handler - the self-shaping handler
 * @returns a handler that injects the hint its resolver returns
 */
export function injectHintAfterCall(handler: ToolCallHandler): HintedToolHandler {
  return async (input, signal, resolveHint) => {
    const result = await handler(input, signal);
    const successHint = resolveHint();
    if (!result.isError && successHint) injectSuccessHint(result, successHint);
    return result;
  };
}

/** Inject a success hint into the first JSON text block of a ToolTextResult.
 *  Skips if the payload already has a toolkit-provided hint. */
function injectSuccessHint(result: ToolTextResult, hint: string): void {
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
