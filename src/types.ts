/**
 * Pure type definitions for the Godot MCP server.
 * Implementation (error utilities, callAndWrap, registerTools) lives in
 * tool_helpers.ts — import from there for runtime functions.
 */
import type { ZodRawShape } from "zod";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { GodotVer } from "./version.js";

// ── Bridge interface ─────────────────────────────────────────────────

export interface Bridge {
  call(method: string, params?: unknown, timeoutMs?: number, signal?: AbortSignal): Promise<unknown>;
  callRuntime(method: string, params?: unknown, timeoutMs?: number, signal?: AbortSignal): Promise<unknown>;
  close(): Promise<void>;
  /** Godot version string from the plugin auth handshake (e.g. "4.5.2"), or null if not yet connected / older plugin. */
  getGodotVersionString(): string | null;
  /** Parsed Godot version as [major, minor] tuple from the registry or auth, or null if unknown. */
  getGodotVersion(): GodotVer | null;
  /** Wait for a runtime port to appear in the registry (game_start async gap).
   *  Resolves with {port} on discovery, null on timeout. Optional — only
   *  available when the bridge was created with a projectPath and registry
   *  watcher. */
  waitForRuntimeConnection?(timeoutMs: number): Promise<{ port: number } | null>;
  /** Proactively tear down the runtime channel (e.g. on game_stopped notification).
   *  Next callRuntime() will fail immediately with GAME_NOT_RUNNING. */
  clearRuntime?(): void;
  /** Return the gate snapshot from the editor channel's most recent auth
   *  handshake, or null if no auth has completed yet. */
  getAuthGates?(): Record<string, boolean> | null;
}

// BridgeError lives in errors.ts (runtime class, not a pure type).

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
  | "CANCELLED"
  | "CLOSED"
  | "COMPILATION_FAILED"
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
  | "LSP_UNAVAILABLE"
  | "INVALID_PARAMS"
  | "INVALID_PATH"
  | "LOAD_FAILED"
  | "LOG_BUSY"
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
  | "NOT_BREAKED"
  | "UNSUPPORTED_FILE_TYPE"
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
  /** Minimum Godot version required ("major.minor", e.g. "4.5"). Omit for 4.2+ (baseline). */
  godotMinVersion?: string;
  /** Maximum Godot version supported ("major.minor", e.g. "4.6"). Omit for no upper bound. */
  godotMaxVersion?: string;
  /** Feature gate name. When set, the tool is only registered when isEnabled(gate) is true; otherwise a LOCKED stub is shown. */
  gate?: string;
  /** Brief guidance appended to successful responses — next steps, related tools, common pitfalls. Omit for terminal actions or self-evident results. Does not overwrite toolkit-provided hints. */
  successHint?: string;
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
