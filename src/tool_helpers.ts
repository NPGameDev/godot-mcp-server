/**
 * Shared tool registration and error utilities.
 * Extracted from types.ts to separate pure type definitions from
 * implementation, satisfying Interface Segregation: modules that only
 * need the Bridge type no longer pull in registration/error logic.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { stableStringify } from "./schema_min.js";
import { isReadOnly, isExcludedByReadOnly } from "./profiles.js";
import type { Bridge, ToolDef, ToolTextResult, ToolRequest, PathGuard } from "./types.js";
import { BridgeError } from "./errors.js";
import { setToolRef } from "./tool_refs.js";
import { isVersionCompatible } from "./version.js";
import { checkPathGuard } from "./path_guard.js";
import {
  toolError,
  toolErrorFromPayload,
  toolErrorFromException,
  runtimeErrorWithCrashContext,
} from "./error_contract.js";
import { isRawJsonSchema, jsonSchemaToZodShape, addStringCoercion } from "./schema_coercion.js";

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

/**
 * Plain-language, inclusive, range-aware support clause for a version-gated
 * tool's bounds. Used ONLY in the UNSUPPORTED error hint (the runtime version
 * gate below) — never in a success/regular hint, tool-def successHint, or
 * schema description. The gate guarantees at least one bound is set, so the
 * final return covers the max-only case. The "–" between bounds is an en-dash
 * (U+2013).
 */
export function versionSupportText(min?: string, max?: string): string {
  if (min && max) return `Supported on Godot ${min}–${max} (inclusive).`;
  if (min) return `Requires Godot ${min} or newer.`;
  return `Supported up to Godot ${max} (inclusive).`;
}

/**
 * Path-guard map (built-in tools only) — name → declared PathGuards. Consulted
 * in the dispatch choke point (wrappedHandler) to syntactically pre-filter
 * path params before the bridge round-trip. Extension tools register without
 * pathParams, so they never have an entry here (toolkit enforces their guards).
 */
const _pathParamMap = new Map<string, readonly PathGuard[]>();

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
  opts: {
    godotMinVersion?: string;
    godotMaxVersion?: string;
    hookPipeline?: HookPipeline;
    pathParams?: readonly PathGuard[];
  } = {},
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
  if (opts.pathParams != null && opts.pathParams.length > 0) {
    _pathParamMap.set(name, opts.pathParams);
  }

  // Registration-time version filter: skip version-gated tools when the
  // connected Godot version is known and incompatible.
  if (opts.godotMinVersion != null || opts.godotMaxVersion != null) {
    const connected = bridge.getGodotVersion();
    if (connected == null) {
      // Version unknown — skip the tool (don't register something we can't
      // verify). It is registered once the version resolves: the version-
      // resolved startup reconcile re-runs registration when the editor first
      // reports its version (index.ts maybeStartupReconcile → handleConfigReload
      // — the server-before-editor cold start), and any later reconnect re-runs
      // it through handleConfigReload as well.
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
        const supported = versionSupportText(verBounds.min, verBounds.max);
        return toolError(
          "UNSUPPORTED",
          `${name} is not supported on this Godot version (connected: ${connected[0]}.${connected[1]})`,
          `${supported} Use classdb.get_info for alternatives.`,
        );
      }
    }

    // Syntactic path pre-filter (built-in tools only) — fast-fail an
    // out-of-bounds path before the WS round-trip. Strict subset of the
    // toolkit's FileGuard (the authoritative boundary). See ADR 0009.
    const guards = _pathParamMap.get(name);
    if (guards) {
      for (const g of guards) {
        const verdict = checkPathGuard(g, input?.[g.param]);
        if (!verdict.ok) {
          return toolError(
            "PATH_DENIED",
            `path rejected (${g.param}): ${verdict.reason}`,
            "Use a project-relative res:// path (user:// for save_* tools). The toolkit is the authoritative guard.",
          );
        }
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
        pathParams: tool.pathParams,
      },
    );
  }
}
