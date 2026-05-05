/**
 * Shared tool registration and error utilities.
 * Extracted from types.ts to separate pure type definitions from
 * implementation, satisfying Interface Segregation: modules that only
 * need the Bridge type no longer pull in registration/error logic.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { stableStringify } from "./schema_min.js";
import { isEnabled, envVarFor } from "./feature_gate.js";
import type { Bridge, ErrorCode, ToolDef, ToolTextResult, ToolRequest } from "./types.js";
import { BridgeError } from "./errors.js";
import { setToolRef } from "./tool_refs.js";

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
  TIMEOUT: "The editor may be busy. Try editor.wait_for_idle before retrying.",
  DISCONNECTED:
    "Plugin WebSocket not connected. Ensure Godot is running with the plugin enabled. If running headless, launch with: godot --headless --editor --path <project>",
  GAME_NOT_RUNNING:
    "No running game detected. Use game.start first. Check editor_get_console for runtime startup errors.",
  LOG_BUSY:
    "Transient file lock during log flush — retry in 1-2 seconds, or use source='buffer' (default) which reads from an in-memory ring buffer with no file I/O.",
  LOG_UNAVAILABLE:
    "Log file not available. Enable file logging in ProjectSettings → Debug → File Logging → Enable File Logging, then restart the editor. Or use source='buffer' (default) which captures all output in real-time.",
  FEATURE_GATED:
    "Toggle the feature gate in the Godot editor dock or set the env var in .mcp.json. Changes are applied live.",
  FEATURE_DISABLED:
    "This tool is disabled in the current profile. Switch to a higher profile or use enable_tool_group to load it dynamically.",
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

// ── Screenshot response builder ─────────────────────────────────────

/**
 * Build a multi-content screenshot response from a bridge result.
 * Shared by editor_screenshot, editor_screenshot_node, and runtime_screenshot.
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
const _versionMap = new Map<string, number>();

export function getVersionMap(): Map<string, number> {
  return _versionMap;
}

// ── JSON Schema → Zod conversion ────────────────────────────────────

/**
 * Detect whether an inputSchema is raw JSON Schema (from extension
 * commands) rather than a Zod shape. Heuristic: top-level "type" or
 * "properties" key with string/object value.
 */
function isRawJsonSchema(schema: unknown): schema is Record<string, unknown> {
  if (!schema || typeof schema !== "object") return false;
  const obj = schema as Record<string, unknown>;
  return typeof obj.type === "string" || (typeof obj.properties === "object" && obj.properties !== null);
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
        zodType = z.number();
        break;
      case "boolean":
        zodType = z.boolean();
        break;
      case "array":
        zodType = z.array(z.any());
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
  handler: (input: Record<string, unknown>) => Promise<ToolTextResult>,
  opts: { godotMinVersion?: number; hookPipeline?: HookPipeline } = {},
): void {
  // Convert raw JSON Schema (from extensions) to Zod shape for SDK compat.
  if (config.inputSchema && isRawJsonSchema(config.inputSchema)) {
    config = { ...config, inputSchema: jsonSchemaToZodShape(config.inputSchema) };
  }
  if (opts.godotMinVersion != null) {
    _versionMap.set(name, opts.godotMinVersion);
  }

  const wrappedHandler = async (input: Record<string, unknown>): Promise<ToolTextResult> => {
    // Version gate check
    const minVer = _versionMap.get(name);
    if (minVer != null) {
      const connected = bridge.getGodotMinor();
      if (connected != null && connected < minVer) {
        return toolError(
          "UNSUPPORTED",
          `${name} requires Godot 4.${minVer}+ (connected: 4.${connected})`,
          "Check COMPATIBILITY.md or use classdb.get_info for alternatives.",
        );
      }
    }

    // Hook pipeline (explicit or global)
    const pipeline = opts.hookPipeline ?? _globalHookPipeline;
    if (pipeline) {
      return pipeline.execute({ name, input: (input ?? {}) as Record<string, unknown> }, () => handler(input));
    }
    return handler(input);
  };

  const ref = server.registerTool(name, config, wrappedHandler);
  setToolRef(name, ref);
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
    handlers?: Map<string, (input: Record<string, unknown>) => Promise<ToolTextResult>>;
    hookPipeline?: HookPipeline;
  } = {},
): void {
  for (const tool of tools) {
    if (allowedTools && !allowedTools.has(tool.name)) continue;

    let description = tool.description;
    const customHandler = opts.handlers?.get(tool.name);
    let handler = (customHandler ?? ((input: unknown) => callAndWrap(bridge, tool.method, input))) as (
      input: unknown,
    ) => Promise<ToolTextResult>;

    // Gated tools: register with full schema, check gate at call time.
    // Static gate note in description avoids ToolSearch cache staleness.
    if (tool.gate) {
      const envVar = envVarFor(tool.gate) ?? tool.gate;
      description = `${tool.description} [gate: ${envVar}]`;
      const baseHandler = handler;
      handler = async (input: unknown) => {
        if (!isEnabled(tool.gate!)) {
          return toolError(
            "FEATURE_GATED",
            `Feature gated — ${envVar} is not enabled.`,
            `Enable via the Feature Gates panel in the Godot editor, or set ${envVar}=1 in .mcp.json env.`,
          );
        }
        return baseHandler(input);
      };
    }

    registerToolWrapped(
      server,
      bridge,
      tool.name,
      { description, inputSchema: tool.inputSchema, annotations: tool.annotations },
      handler as (input: Record<string, unknown>) => Promise<ToolTextResult>,
      {
        godotMinVersion: tool.godotMinVersion,
        hookPipeline: opts.hookPipeline,
      },
    );
  }
}
