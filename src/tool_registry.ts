/**
 * Tool registry — install tools through one wrapped, pre-flighted path
 * (version-gate, path-guard, hook-pipeline) and register them with the MCP
 * server. The per-call dispatch primitive lives in tool_dispatch.ts, error
 * shaping in error_contract.ts, input coercion in schema_coercion.ts.
 * Originally split from types.ts to keep pure type definitions free of
 * registration logic (Interface Segregation).
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isReadOnly, isExcludedByReadOnly } from "./profiles.js";
import type { Bridge, ToolDef, ToolTextResult, ToolRequest, PathGuard } from "./types.js";
import { setToolRef } from "./tool_refs.js";
import { isVersionCompatible } from "./version.js";
import { checkPathGuard } from "./path_guard.js";
import { toolError } from "./error_contract.js";
import { isRawJsonSchema, jsonSchemaToZodShape, addStringCoercion } from "./schema_coercion.js";
import { callAndWrap, injectSuccessHint } from "./tool_dispatch.js";

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
