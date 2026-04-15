export interface Bridge {
  call(method: string, params?: unknown, timeoutMs?: number): Promise<unknown>;
  callRuntime(method: string, params?: unknown, timeoutMs?: number): Promise<unknown>;
  close(): Promise<void>;
}

export class BridgeError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "BridgeError";
  }
}

// I1 error contract (iter 14). Canonical list of MCP tool-error codes —
// UPPER_SNAKE_CASE. Keep in sync with MCP_ERROR_CODES in mcp_server.gd +
// mcp_runtime_server.gd (toolkit-repo) and the reference table in
// CLAUDE.md. New codes require updates to BOTH sides (plugin emits them;
// bridge/tools may pass through additional transport-level codes —
// CLOSED, NO_RUNTIME_URL, RPC_ERROR, SEND_FAILED — which originate in
// bridge.ts and never travel through the plugin).
export type ErrorCode =
  | "ALREADY_EXISTS"
  | "CLOSED"
  | "CONNECT_FAILED"
  | "DISCONNECTED"
  | "EXECUTE_FAILED"
  | "FEATURE_DISABLED"
  | "FILE_TOO_LARGE"
  | "GAME_NOT_RUNNING"
  | "INTERNAL"
  | "INVALID_CLASS"
  | "INVALID_PARAMS"
  | "INVALID_PATH"
  | "LOAD_FAILED"
  | "NO_RUNTIME_URL"
  | "NO_SCENE"
  | "NOT_FOUND"
  | "PARSE_ERROR"
  | "PATH_DENIED"
  | "READ_FAILED"
  | "RPC_ERROR"
  | "SAVE_FAILED"
  | "SEND_FAILED"
  | "TIMEOUT"
  | "WRITE_FAILED";

export type ToolTextResult = {
  content: { type: "text"; text: string }[];
  isError?: true;
};

// toolError — canonical MCP failure response per I1. Plugin emits
// {success: false, error, code} inside the JSON-RPC result payload;
// transport-level failures surface as BridgeError and are translated
// here. String `code` is accepted (in addition to the ErrorCode union)
// because bridge errors (RPC_ERROR etc.) aren't statically typed at
// every call site.
export function toolError(code: ErrorCode | string, message: string): ToolTextResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ success: false, error: message, code }) }],
    isError: true,
  };
}

// callAndWrap — shared handler body for tools that do a single bridge
// call and JSON-stringify the result. Centralises I1 compliance:
//   1. Try/catch around the bridge call — BridgeError becomes toolError.
//   2. Result payload inspection — {success: false} becomes toolError.
//   3. Happy path — JSON-stringified into a text content block.
// Screenshots and other multi-content handlers stay custom but use
// toolError directly for their error branches.
export async function callAndWrap(
  bridge: Bridge,
  method: string,
  input: unknown,
  opts: { runtime?: boolean; timeoutMs?: number } = {},
): Promise<ToolTextResult> {
  try {
    const result = opts.runtime
      ? await bridge.callRuntime(method, input, opts.timeoutMs)
      : await bridge.call(method, input, opts.timeoutMs);
    const err = toolErrorFromPayload(result);
    if (err) return err;
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  } catch (err) {
    return toolErrorFromException(err);
  }
}

// toolErrorFromPayload — if the plugin returned {success: false, ...}
// inside the JSON-RPC result, translate it to an MCP isError response.
// Non-error successes (including {code: "ALREADY_EXISTS", path: ...}
// returned by idempotent create paths, per I3) have success absent or
// truthy and pass through unchanged.
export function toolErrorFromPayload(result: unknown): ToolTextResult | null {
  if (!result || typeof result !== "object") return null;
  const obj = result as { success?: unknown; code?: unknown; error?: unknown };
  if (obj.success !== false) return null;
  const code = typeof obj.code === "string" ? obj.code : "INTERNAL";
  const error = typeof obj.error === "string" ? obj.error : "unknown error";
  return toolError(code, error);
}

// toolErrorFromException — map a thrown BridgeError (or any Error) to a
// toolError response. Preserves the bridge's transport-layer code
// (TIMEOUT, DISCONNECTED, GAME_NOT_RUNNING, CONNECT_FAILED, …) so the
// Claude-facing response is specific enough to retry-or-give-up on.
export function toolErrorFromException(err: unknown): ToolTextResult {
  const code = err instanceof BridgeError ? err.code : "INTERNAL";
  const message = (err as Error)?.message ?? String(err);
  return toolError(code, message);
}
