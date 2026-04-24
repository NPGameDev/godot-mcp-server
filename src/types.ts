import type { ZodRawShape } from "zod";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { stableStringify } from "./schema_min.js";

// ── Bridge interface ─────────────────────────────────────────────────

export interface Bridge {
  call(method: string, params?: unknown, timeoutMs?: number): Promise<unknown>;
  callRuntime(method: string, params?: unknown, timeoutMs?: number): Promise<unknown>;
  close(): Promise<void>;
  /** Godot version string from the plugin auth handshake (e.g. "4.5.2"), or null if not yet connected / older plugin. */
  getGodotVersion(): string | null;
  /** Godot minor version number (e.g. 5 for "4.5.2"), or null if unknown. */
  getGodotMinor(): number | null;
}

export class BridgeError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "BridgeError";
  }
}

// ── Error codes ──────────────────────────────────────────────────────

// Canonical list of MCP tool-error codes (UPPER_SNAKE_CASE). Keep in sync
// with MCP_ERROR_CODES in mcp_server.gd + mcp_runtime_server.gd
// (toolkit-repo) and the reference table in CLAUDE.md. New codes require
// updates to BOTH sides (plugin emits them; bridge/tools may pass through
// additional transport-level codes — CLOSED, NO_RUNTIME_URL, RPC_ERROR,
// SEND_FAILED — which originate in bridge.ts and never travel through the
// plugin).
export type ErrorCode =
  | "ALREADY_EXISTS"
  | "ALREADY_PLAYING"
  | "CLOSED"
  | "CONNECT_FAILED"
  | "CREATE_DIR_FAILED"
  | "DELETE_FAILED"
  | "DIR_NOT_EMPTY"
  | "DISCONNECTED"
  | "EDITED_SCENE"
  | "EXECUTE_FAILED"
  | "FEATURE_DISABLED"
  | "FILE_TOO_LARGE"
  | "FILESYSTEM_NOT_READY"
  | "FOLDER_PROTECTED"
  | "GAME_NOT_RUNNING"
  | "INTERNAL"
  | "INVALID_CLASS"
  | "INVALID_METHOD"
  | "INVALID_PARAMS"
  | "INVALID_PATH"
  | "LOAD_FAILED"
  | "LOG_UNAVAILABLE"
  | "NO_RUNTIME_URL"
  | "NO_SCENE"
  | "NOT_A_RESOURCE"
  | "NOT_FOUND"
  | "PACK_FAILED"
  | "PARENT_NOT_FOUND"
  | "PARSE_ERROR"
  | "PATH_DENIED"
  | "PATH_IN_USE"
  | "READ_FAILED"
  | "RPC_ERROR"
  | "SAVE_DELETE_FAILED"
  | "SAVE_FAILED"
  | "SAVE_READ_FAILED"
  | "SAVE_WRITE_FAILED"
  | "SEND_FAILED"
  | "TIMEOUT"
  | "UNSUPPORTED"
  | "USER_PATH_NOT_WHITELISTED"
  | "USER_SCOPE_DISABLED"
  | "WRITE_FAILED";

// ── Tool definition ──────────────────────────────────────────────────

export type { ToolAnnotations };

export type ToolDef = {
  name: string;
  method: string;
  description: string;
  inputSchema: ZodRawShape;
  annotations?: ToolAnnotations;
  /** Minimum Godot minor version required (e.g. 5 for 4.5+). Omit for 4.3+ (baseline). */
  godotMinVersion?: number;
};

export type ToolTextResult = {
  content: { type: "text"; text: string }[];
  isError?: true;
};

// ── Hook pipeline types ──────────────────────────────────────────────

/** Identifies the tool being called — passed to every hook. */
export type ToolRequest = {
  name: string;
  input: Record<string, unknown>;
};

/**
 * Middleware function that wraps tool dispatch.
 * Call `next()` to continue the chain; return early to short-circuit.
 */
export type Hook = (req: ToolRequest, next: () => Promise<ToolTextResult>) => Promise<ToolTextResult>;

// ── Shared error utilities ───────────────────────────────────────────

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
export function toolErrorFromPayload(result: unknown): ToolTextResult | null {
  if (!result || typeof result !== "object") return null;
  const obj = result as { success?: unknown; code?: unknown; error?: unknown; hint?: unknown };
  if (obj.success !== false) return null;
  const code = typeof obj.code === "string" ? obj.code : "INTERNAL";
  const error = typeof obj.error === "string" ? obj.error : "unknown error";
  const hint = typeof obj.hint === "string" ? obj.hint : undefined;
  return toolError(code, error, hint);
}

/** Default hints for transport-level exception codes. */
const EXCEPTION_HINTS: Record<string, string> = {
  TIMEOUT: "The editor may be busy. Try editor.wait_for_idle before retrying.",
};

/**
 * Map a thrown BridgeError (or any Error) to a toolError response.
 * Preserves the bridge's transport-layer code (TIMEOUT, DISCONNECTED,
 * GAME_NOT_RUNNING, CONNECT_FAILED, ...) so the client-facing response
 * is specific enough to retry-or-give-up on.
 */
export function toolErrorFromException(err: unknown): ToolTextResult {
  const code = err instanceof BridgeError ? err.code : "INTERNAL";
  const message = (err as Error)?.message ?? String(err);
  return toolError(code, message, EXCEPTION_HINTS[code]);
}

// ── Shared call wrapper ──────────────────────────────────────────────

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
  opts: { runtime?: boolean; timeoutMs?: number } = {},
): Promise<ToolTextResult> {
  try {
    const result = opts.runtime
      ? await bridge.callRuntime(method, input, opts.timeoutMs)
      : await bridge.call(method, input, opts.timeoutMs);
    const err = toolErrorFromPayload(result);
    if (err) return err;
    return { content: [{ type: "text", text: stableStringify(result) }] };
  } catch (err) {
    return toolErrorFromException(err);
  }
}

// ── Shared registration ──────────────────────────────────────────────

/**
 * Register an array of tool definitions with the standard callAndWrap
 * handler. Used by tool modules whose tools all follow the default
 * "call bridge, JSON-stringify result" pattern. Modules with custom
 * response processing (multi-content screenshots, summary-first
 * payloads, etc.) register their tools directly.
 */
export function registerTools(
  server: McpServer,
  bridge: Bridge,
  tools: readonly ToolDef[],
  allowedTools: Set<string> | null = null,
): void {
  for (const tool of tools) {
    if (allowedTools && !allowedTools.has(tool.name)) continue;
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations },
      (input: unknown) => callAndWrap(bridge, tool.method, input),
    );
  }
}
