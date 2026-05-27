/**
 * Shared tool registration and error utilities.
 * Extracted from types.ts to separate pure type definitions from
 * implementation, satisfying Interface Segregation: modules that only
 * need the Bridge type no longer pull in registration/error logic.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { stableStringify } from "./schema_min.js";
import { isReadOnly, isExcludedByReadOnly } from "./profiles.js";
import type { Bridge, ErrorCode, ToolDef, ToolTextResult, ToolRequest } from "./types.js";
import { BridgeError } from "./errors.js";
import { setToolRef } from "./tool_refs.js";
import { isVersionCompatible } from "./version.js";

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
  TIMEOUT:
    "The editor or game may be busy, or the game failed to compile/start. " +
    "For editor calls, try editor.wait_for_idle. For runtime calls, " +
    "debugger_get_log returns cached output after a crash. If empty, call editor_get_console without level_filter.",
  COMPILATION_FAILED:
    "The game failed to compile. Fix the script errors listed above, then call game_start again. " +
    "If no errors are shown, call editor_refresh to retrigger them, then editor_get_console for the full log.",
  DISCONNECTED:
    "Plugin WebSocket not connected. Ensure Godot is running with the plugin enabled. If running headless, launch with: godot --headless --editor --path <project>",
  GAME_NOT_RUNNING:
    "No running game. Call editor_get_console(level_filter:['error']) for crash diagnostics. " +
    "If empty, the game may have crashed — debugger_get_log serves cached output from log file after a real crash (OS signal). " +
    "To restart: fix the errors, then game_start.",
  LOG_BUSY:
    "Transient file lock during log flush — retry in 1-2 seconds, or use source='buffer' (default) which reads from an in-memory ring buffer with no file I/O.",
  LOG_UNAVAILABLE:
    "Log file not available. Enable file logging in ProjectSettings → Debug → File Logging → Enable File Logging, then restart the editor. Or use source='buffer' (default) which captures all output in real-time.",
  FEATURE_DISABLED: "This tool is disabled. Use discover_tools to load it dynamically.",
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
    const count = result?.count;
    if (typeof count === "number" && count === 0) return "";
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
    if (opts.successHint && result && typeof result === "object" && !(result as Record<string, unknown>).hint) {
      (result as Record<string, unknown>).hint = opts.successHint;
    }
    return { content: [{ type: "text", text: stableStringify(result) }] };
  } catch (err) {
    if (opts.runtime) return runtimeErrorWithCrashContext(bridge, err);
    if (opts.extensionTimeoutHint && err instanceof BridgeError && err.code === "TIMEOUT") {
      return toolError("TIMEOUT", err.message, opts.extensionTimeoutHint);
    }
    return toolErrorFromException(err);
  }
}

// ── Screenshot response builder ─────────────────────────────────────

/**
 * Build a multi-content screenshot response from a bridge result.
 * Shared by editor_screenshot and runtime_screenshot.
 */
export function buildScreenshotResponse(result: unknown): ToolTextResult {
  const r = result as {
    image_base64?: string;
    mime_type?: string;
    width?: number;
    height?: number;
    bytes?: number;
  };
  if (!r?.image_base64) {
    return toolErrorFromPayload(result) ?? { content: [{ type: "text", text: stableStringify(result) }] };
  }
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ width: r.width, height: r.height, bytes: r.bytes, mime_type: r.mime_type }),
      },
      { type: "image" as unknown as "text", data: r.image_base64, mimeType: r.mime_type ?? "image/png" } as unknown as {
        type: "text";
        text: string;
      },
    ],
  };
}

// ── Registration helpers ────────────────────────────────────────────

type HookPipeline = { execute: (req: ToolRequest, next: () => Promise<ToolTextResult>) => Promise<ToolTextResult> };

/** Global hook pipeline — set once at startup via setGlobalHookPipeline. */
let _globalHookPipeline: HookPipeline | null = null;

/** Set the global hook pipeline. Called once at server startup. */
export function setGlobalHookPipeline(pipeline: HookPipeline): void {
  _globalHookPipeline = pipeline;
}

/** Version gate map — populated by registerToolWrapped callers. */
const _versionMap = new Map<string, { min?: string; max?: string }>();

export function getVersionMap(): Map<string, { min?: string; max?: string }> {
  return _versionMap;
}

// ── MCP string-coercion helpers ────────────────────────────────────

/**
 * Boolean schema that coerces string inputs ("true"→true, "false"→false).
 * MCP clients may send all values as strings for dynamically-registered
 * tools (added via tools/list_changed). Standard z.boolean() rejects
 * strings; z.coerce.boolean() converts "false" to true (truthy string).
 * This preprocess handles the "false" case correctly.
 */
export const coercedBoolean = () =>
  z.preprocess((v) => (typeof v === "string" ? v.toLowerCase() === "true" || v === "1" : v), z.boolean());

/**
 * Preprocess for JSON-string coercion: parses stringified arrays/objects.
 * Same root cause as coercedBoolean — MCP clients may serialize complex
 * values as JSON strings rather than native JSON types.
 */
export const jsonCoerce = (v: unknown) => {
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }
  return v;
};

// ── LLM string coercion ────────────────────────────────────────────
// LLM agents sometimes serialize complex params as JSON strings instead
// of passing structured values (e.g. "[{...}]" instead of [{...}]).
// This pre-validation pass tries JSON.parse on string values when the
// schema expects array/object/number/boolean.

export function coerceStringValue(val: unknown): unknown {
  if (typeof val !== "string") return val;
  // Fast-reject: strings that clearly aren't JSON-encoded values
  const trimmed = val.trim();
  if (trimmed.length === 0) return val;
  const first = trimmed[0];
  if (
    first !== "[" &&
    first !== "{" &&
    first !== '"' &&
    first !== "t" &&
    first !== "f" &&
    first !== "n" &&
    !/^-?\d/.test(trimmed)
  ) {
    return val;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return val;
  }
}

/** Resolve the innermost Zod type name, unwrapping optional/nullable/default. */
export function innerZodType(schema: z.ZodTypeAny): string | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Zod v4 internal
  let s = schema as any;
  // Walk through wrappers: optional → ZodOptional._zod.def.innerType,
  // nullable → ZodNullable._zod.def.innerType, default → ZodDefault._zod.def.innerType.
  while (s?._zod?.def?.innerType) {
    s = s._zod.def.innerType;
  }
  return s?._zod?.def?.type as string | undefined;
}

/**
 * Wrap each top-level key in a Zod shape with z.preprocess() so that
 * JSON-encoded strings are parsed before Zod validation. Skips params
 * whose schema expects a string — a JSON-encoded string value passed
 * to a string param should not be unwrapped.
 */
export function addStringCoercion(shape: Record<string, z.ZodTypeAny>): Record<string, z.ZodTypeAny> {
  const coerced: Record<string, z.ZodTypeAny> = {};
  for (const [key, schema] of Object.entries(shape)) {
    const inner = innerZodType(schema);
    // Skip schemas that are string-typed (would unwrap intended JSON strings),
    // enum-typed (discrete values, not JSON), or already preprocessed (pipe —
    // e.g. coercedBoolean() already handles its own string coercion).
    if (inner === "string" || inner === "enum" || inner === "pipe") {
      coerced[key] = schema;
    } else {
      coerced[key] = z.preprocess(coerceStringValue, schema);
    }
  }
  return coerced;
}

// ── JSON Schema → Zod conversion ────────────────────────────────────

/**
 * Detect whether an inputSchema is raw JSON Schema (from extension
 * commands) rather than a Zod shape. Heuristic: top-level "type" key
 * with plain string value, OR "properties" key that is a plain object
 * (not a Zod schema). Zod schemas have a `_zod` property; plain JSON
 * Schema `properties` objects do not.
 */
function isRawJsonSchema(schema: unknown): schema is Record<string, unknown> {
  if (!schema || typeof schema !== "object") return false;
  const obj = schema as Record<string, unknown>;
  if (typeof obj.type === "string") return true;
  if (typeof obj.properties === "object" && obj.properties !== null) {
    // A Zod schema (used as a field named "properties") has _zod; a
    // JSON Schema properties object is a plain dict of field descriptors.
    return !(obj.properties as Record<string, unknown>)._zod;
  }
  return false;
}

/**
 * Convert a raw JSON Schema object to a Zod shape compatible with the
 * MCP SDK's registerTool. Handles the common types extension authors use.
 */
function jsonSchemaToZodShape(schema: Record<string, unknown>): Record<string, z.ZodTypeAny> {
  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
  if (!properties) return {};

  const required = new Set((schema.required as string[]) ?? []);
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, prop] of Object.entries(properties)) {
    let zodType: z.ZodTypeAny;
    switch (prop.type) {
      case "string":
        if (Array.isArray(prop.enum) && prop.enum.length > 0) {
          zodType = z.enum(prop.enum as [string, ...string[]]);
        } else {
          zodType = z.string();
        }
        break;
      case "number":
      case "integer":
        zodType = z.coerce.number();
        break;
      case "boolean":
        zodType = coercedBoolean();
        break;
      case "array":
        zodType = z.preprocess(jsonCoerce, z.array(z.any()));
        break;
      default:
        zodType = z.any();
        break;
    }
    if (typeof prop.description === "string") {
      zodType = zodType.describe(prop.description);
    }
    if (!required.has(key)) {
      zodType = zodType.optional();
    }
    shape[key] = zodType;
  }
  return shape;
}

// ── JSON Schema → param map (reverse of jsonSchemaToZodShape) ──────

/** Simplified parameter info for LLM-facing tool metadata. */
export interface ParamInfo {
  type: string;
  required: boolean;
  description?: string;
}

/**
 * Flatten a JSON Schema properties/required structure to a simplified
 * parameter map. Mirrors jsonSchemaToZodShape() in reverse — used by
 * tool_meta.ts to build human-readable param info for discover_tools
 * enrichment. Handles the same types as jsonSchemaToZodShape.
 */
export function jsonSchemaToParamMap(schema: Record<string, unknown>): Record<string, ParamInfo> {
  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
  if (!properties) return {};

  const required = new Set((schema.required as string[]) ?? []);
  const params: Record<string, ParamInfo> = {};

  for (const [key, prop] of Object.entries(properties)) {
    let type: string;
    switch (prop.type) {
      case "string":
        type = Array.isArray(prop.enum) && prop.enum.length > 0 ? "enum" : "string";
        break;
      case "number":
      case "integer":
        type = "number";
        break;
      case "boolean":
        type = "boolean";
        break;
      case "array":
        type = "array";
        break;
      default:
        type = "string";
        break;
    }
    const description = typeof prop.description === "string" ? prop.description : undefined;
    params[key] = { type, required: required.has(key), ...(description && { description }) };
  }
  return params;
}

/**
 * Suppress per-tool sendToolListChanged() notifications during a batch
 * operation, then emit a single notification at the end. Use this when
 * registering multiple tools in a tight loop.
 */
export function batchToolRegistration(server: McpServer, fn: () => void): void {
  const orig = server.sendToolListChanged.bind(server);
  server.sendToolListChanged = () => {};
  try {
    fn();
  } finally {
    server.sendToolListChanged = orig;
    server.sendToolListChanged();
  }
}

/**
 * Register a tool with version-gating, hook pipeline wrapping, and
 * tool-ref tracking. All tool registrations should use this instead of
 * server.registerTool directly.
 */
export function registerToolWrapped(
  server: McpServer,
  bridge: Bridge,
  name: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- McpServer.registerTool has complex overloaded types
  config: any,
  handler: (input: Record<string, unknown>, signal?: AbortSignal) => Promise<ToolTextResult>,
  opts: { godotMinVersion?: string; godotMaxVersion?: string; hookPipeline?: HookPipeline } = {},
): void {
  // Convert raw JSON Schema (from extensions) to Zod shape for SDK compat.
  if (config.inputSchema && isRawJsonSchema(config.inputSchema)) {
    config = { ...config, inputSchema: jsonSchemaToZodShape(config.inputSchema) };
  }
  // Add LLM string coercion to all Zod shapes — agents sometimes send
  // JSON-encoded strings for array/object/number params.
  if (config.inputSchema && !isRawJsonSchema(config.inputSchema)) {
    config = { ...config, inputSchema: addStringCoercion(config.inputSchema) };
  }
  if (opts.godotMinVersion != null || opts.godotMaxVersion != null) {
    _versionMap.set(name, { min: opts.godotMinVersion, max: opts.godotMaxVersion });
  }

  // Registration-time version filter: skip version-gated tools when the
  // connected Godot version is known and incompatible.
  if (opts.godotMinVersion != null || opts.godotMaxVersion != null) {
    const connected = bridge.getGodotVersion();
    if (connected == null) {
      // Version unknown — skip the tool (don't register something we
      // can't verify). It will be registered on reconnect when the
      // version becomes known via handleConfigReload.
      return;
    }
    if (!isVersionCompatible(connected, opts.godotMinVersion, opts.godotMaxVersion)) {
      return;
    }
  }

  // The SDK passes (args, extra) to tool handlers; extra.signal is an
  // AbortSignal that fires when the MCP client sends notifications/cancelled.
  // Defensive: extra may be undefined if the SDK omits it (observed with
  // some client versions) — use optional chaining.
  const wrappedHandler = async (
    input: Record<string, unknown>,
    extra?: { signal?: AbortSignal },
  ): Promise<ToolTextResult> => {
    const signal = extra?.signal;
    // Defence-in-depth: runtime version check for version-gated tools
    // (catches reconnect to a different Godot version).
    const verBounds = _versionMap.get(name);
    if (verBounds != null) {
      const connected = bridge.getGodotVersion();
      if (connected != null && !isVersionCompatible(connected, verBounds.min, verBounds.max)) {
        const parts: string[] = [];
        if (verBounds.min) parts.push(`>= ${verBounds.min}`);
        if (verBounds.max) parts.push(`<= ${verBounds.max}`);
        return toolError(
          "UNSUPPORTED",
          `${name} requires Godot ${parts.join(" and ")} (connected: ${connected[0]}.${connected[1]})`,
          "Check COMPATIBILITY.md or use classdb.get_info for alternatives.",
        );
      }
    }

    // Hook pipeline (explicit or global)
    const pipeline = opts.hookPipeline ?? _globalHookPipeline;
    if (pipeline) {
      return pipeline.execute({ name, input: (input ?? {}) as Record<string, unknown> }, () => handler(input, signal));
    }
    return handler(input, signal);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- handler 2-arg shape doesn't match SDK overloads
  const ref = server.registerTool(name, config, wrappedHandler as any);
  setToolRef(name, ref);
}

/** Inject a success hint into the first JSON text block of a ToolTextResult.
 *  Skips if the payload already has a toolkit-provided hint. */
function injectSuccessHint(result: ToolTextResult, hint: string): void {
  for (const block of result.content) {
    if (block.type === "text") {
      try {
        const payload = JSON.parse(block.text);
        if (typeof payload === "object" && payload !== null && !payload.hint) {
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

/**
 * Register an array of tool definitions with the standard callAndWrap
 * handler. Used by tool modules whose tools all follow the default
 * "call bridge, JSON-stringify result" pattern.
 *
 * Supports optional per-tool handler overrides for modules that have
 * custom response processing (screenshots, summary-first, etc.).
 */
export function registerTools(
  server: McpServer,
  bridge: Bridge,
  tools: readonly ToolDef[],
  allowedTools: Set<string> | null = null,
  opts: {
    handlers?: Map<string, (input: Record<string, unknown>, signal?: AbortSignal) => Promise<ToolTextResult>>;
    hookPipeline?: HookPipeline;
  } = {},
): void {
  const readOnly = isReadOnly();
  for (const tool of tools) {
    if (allowedTools && !allowedTools.has(tool.name)) continue;
    if (isExcludedByReadOnly(readOnly, tool.annotations)) continue;

    const description = tool.description;
    const customHandler = opts.handlers?.get(tool.name);
    let handler = (customHandler ??
      ((input: unknown, signal?: AbortSignal) =>
        callAndWrap(bridge, tool.method, input, { signal, successHint: tool.successHint }))) as (
      input: unknown,
      signal?: AbortSignal,
    ) => Promise<ToolTextResult>;

    // Custom handlers bypass callAndWrap, so inject successHint via wrapper.
    if (customHandler && tool.successHint) {
      const baseHandler = handler;
      const hintText = tool.successHint;
      handler = (async (input: unknown, signal?: AbortSignal) => {
        const result = await baseHandler(input, signal);
        if (!result.isError) injectSuccessHint(result, hintText);
        return result;
      }) as typeof handler;
    }

    registerToolWrapped(
      server,
      bridge,
      tool.name,
      { description, inputSchema: tool.inputSchema, annotations: tool.annotations },
      handler as (input: Record<string, unknown>) => Promise<ToolTextResult>,
      {
        godotMinVersion: tool.godotMinVersion,
        godotMaxVersion: tool.godotMaxVersion,
        hookPipeline: opts.hookPipeline,
      },
    );
  }
}
