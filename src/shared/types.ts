/**
 * Pure type definitions for the Godot MCP server — the leaf type module the
 * runtime graph depends on but which names no runtime symbol itself, so nothing
 * ever cycles back through it. The core wire / {@link Bridge} / {@link ErrorCode}
 * contracts are defined here; the functions that implement them live in the
 * registration, dispatch, and transport modules.
 *
 * @module
 */
import type { ZodRawShape } from "zod";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { GodotVer } from "./version.js";

// ── Bridge interface ─────────────────────────────────────────────────

/**
 * The transport facade the whole tool layer calls through — one connected Godot
 * editor channel plus the lazy playtest-runtime channel. Built by `createBridge`
 * (transport/bridge.ts); tool modules receive it and never touch sockets directly.
 */
export interface Bridge {
  call(method: string, params?: unknown, timeoutMs?: number, signal?: AbortSignal): Promise<unknown>;
  callRuntime(method: string, params?: unknown, timeoutMs?: number, signal?: AbortSignal): Promise<unknown>;
  close(): Promise<void>;
  /** Godot version string from the plugin auth handshake (e.g. "4.5.2"), or undefined if not yet connected / older plugin. */
  getGodotVersionString(): string | undefined;
  /** Parsed Godot version as [major, minor] tuple from the registry or auth, or undefined if unknown. */
  getGodotVersion(): GodotVer | undefined;
  /** Wait for a runtime port to appear in the registry (game_start async gap).
   *  Resolves with {port} on discovery, undefined on timeout. Optional — only
   *  available when the bridge was created with a projectPath and registry
   *  watcher. */
  waitForRuntimeConnection?(timeoutMs: number): Promise<{ port: number } | undefined>;
  /** Proactively tear down the runtime channel (e.g. on game_stopped notification).
   *  Next callRuntime() will fail immediately with GAME_NOT_RUNNING. */
  clearRuntime?(): void;
}

/** Handler invoked for an unsolicited plugin notification routed off a channel. */
export type NotificationHandler = (type: string, params?: Record<string, unknown>) => void;

// BridgeError lives in errors.ts (runtime class, not a pure type).

// ── Error codes ──────────────────────────────────────────────────────

/**
 * Canonical MCP tool-error codes (UPPER_SNAKE_CASE) — the cross-repo error
 * contract. Must stay in sync with `MCP_ERROR_CODES` in the toolkit
 * (`mcp_server.gd` + `mcp_runtime_server.gd`): a new plugin-emitted code touches
 * both repos. The transport-level codes (`CLOSED`, `RPC_ERROR`, `SEND_FAILED`)
 * originate in the bridge and never travel through the plugin.
 */
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
  | "WRITE_FAILED";

// ── Path guard declaration ───────────────────────────────────────────

/**
 * Declares that a tool input param carries a filesystem path that the server
 * should syntactically pre-filter (defense-in-depth / fast-fail) before the WS
 * round-trip. A strict subset of the toolkit's canonicalizing FileGuard — see
 * src/path_guard.ts and ADR 0009 (toolkit).
 *
 * `guard: "project"` ↔ res:// (FileGuard.resolve_safe); `guard: "user"` ↔ user://
 * (FileGuard.resolve_safe_user). Use the explicit `prefixes` form only for the
 * rare multi-prefix outlier (editor_screenshot.save_path).
 *
 * Declare a param here ONLY if the toolkit also guards it with the same prefix
 * (strict-subset invariant — never reject a path the toolkit accepts). Params
 * the toolkit does NOT guard (source_path = absolute allowed; texture_path =
 * ResourceLoader res://-scoped) and scene-tree node paths (node_path,
 * parent_path, …) are deliberately NOT declared.
 */
export type PathGuard = { param: string; guard: "project" | "user" } | { param: string; prefixes: readonly string[] };

// ── Tool definition ──────────────────────────────────────────────────

export type { ToolAnnotations };

/**
 * One built-in tool's static definition — the catalogue entry the registration
 * layer turns into a live MCP tool. The catalogue is the SSOT; every field here
 * is consumed at registration time.
 */
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
  /** Brief guidance appended to successful responses — next steps, related tools, common pitfalls. Omit for terminal actions or self-evident results. Does not overwrite toolkit-provided hints. */
  successHint?: string;
  /** Filesystem-path params to syntactically pre-filter before dispatch (strict
   *  subset of the toolkit guard). Omit for tools with no fs path, or for params
   *  the toolkit doesn't guard (absolute-allowed source_path, node-tree paths). */
  pathParams?: readonly PathGuard[];
};

/** An MCP tool response — one or more text blocks; `isError` marks a tool-level failure. */
export type ToolTextResult = {
  content: { type: "text"; text: string }[];
  isError?: true;
};

// ── Extension command wire shape ─────────────────────────────────────

/**
 * One extension command as it arrives over the wire from the toolkit plugin —
 * the payload of extensions.refresh/list results (ExtResult.commands[]) and the
 * extensions.changed push notification. Snake_case fields mirror the GDScript
 * registry; the server maps them to camelCase MCP tool config at registration.
 */
export type ExtensionCmdWire = {
  method: string;
  description?: string;
  input_schema?: Record<string, unknown>;
  annotations?: Record<string, boolean>;
  group?: { name: string; description?: string; keywords?: string[] };
  timeout_ms?: number;
  min_godot_version?: string;
  max_godot_version?: string;
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
