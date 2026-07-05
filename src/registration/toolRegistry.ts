/**
 * Tool registry — the one wrapped, pre-flighted path for installing tools onto
 * the MCP server. Every built-in and extension tool registers through
 * {@link registerToolWrapped} (or the bulk {@link registerTools}), which layers
 * version-gating, syntactic path-guarding, hook-pipeline wrapping, LLM string
 * coercion, and tool-ref tracking around the SDK's raw `server.registerTool`.
 * Registering with the SDK directly silently drops every one of those guarantees.
 *
 * @remarks
 * Per-call dispatch, error shaping, and JSON-Schema → Zod coercion live in sibling
 * modules under `registration/` and `shared/`; this module owns only the
 * registration choke point and its two pre-flight maps (version bounds + path guards).
 *
 * @module
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isReadOnly, isExcludedByReadOnly } from "../security/profiles.js";
import type { Bridge, ToolDef, ToolTextResult, ToolRequest, PathGuard } from "../shared/types.js";
import { setToolRef } from "./toolRefs.js";
import { isVersionCompatible } from "../shared/version.js";
import { checkPathGuard } from "../security/pathGuard.js";
import { toolError } from "../shared/errorContract.js";
import { isRawJsonSchema, jsonSchemaToZodShape, addStringCoercion } from "../shared/schemaCoercion.js";
import { callAndWrap, injectSuccessHint } from "./toolDispatch.js";

// ── Registration helpers ────────────────────────────────────────────

/**
 * Structural shape of a hook pipeline accepted by the registration functions —
 * anything that can `execute(req, next)`. The concrete pipeline is built by the
 * startup hooks module; this internal alias keeps the registration surface
 * decoupled from that construction.
 * @internal
 */
type HookPipeline = { execute: (req: ToolRequest, next: () => Promise<ToolTextResult>) => Promise<ToolTextResult> };

/** Global hook pipeline — set once at startup via setGlobalHookPipeline. */
let globalHookPipeline: HookPipeline | undefined = undefined;

/**
 * Set the global hook pipeline. Called once at server startup.
 * @internal
 */
export function setGlobalHookPipeline(pipeline: HookPipeline): void {
  globalHookPipeline = pipeline;
}

/** Version gate map — populated by registerToolWrapped callers. */
const versionMap = new Map<string, { min?: string; max?: string }>();

/**
 * Plain-language, inclusive, range-aware support clause for a version-gated
 * tool's bounds. Used ONLY in the UNSUPPORTED error hint (the runtime version
 * gate below) — never in a success/regular hint, tool-def successHint, or
 * schema description. The gate guarantees at least one bound is set, so the
 * final return covers the max-only case. The "–" between bounds is an en-dash
 * (U+2013).
 * @internal
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
const pathParamMap = new Map<string, readonly PathGuard[]>();

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
 * Register one tool through the wrapped, pre-flighted path — the **only**
 * sanctioned way to install a tool. Wraps the SDK handler with a runtime version
 * gate, a syntactic path pre-filter, and the hook pipeline, then records the tool
 * ref for later lookup and in-place description refresh.
 *
 * @param name - the tool's MCP wire name (what the client calls)
 * @param config - the SDK tool config (description, `inputSchema`, annotations);
 *   raw JSON-Schema from extensions is converted to Zod, and string coercion is
 *   added so agents may pass JSON-encoded scalars for array/object/number params
 * @param handler - the dispatch function invoked on a call, after every pre-flight check passes
 * @param opts - version bounds, an explicit hook pipeline (falls back to the
 *   global one), and path-guard declarations to pre-filter before the bridge round-trip
 *
 * @remarks
 * Version-gated tools are filtered out at registration when the connected Godot
 * version is known and incompatible, and **skipped** when the version is not yet
 * known — the startup reconcile re-runs registration once it resolves. A second,
 * defence-in-depth version check runs per call to catch a reconnect to a different
 * Godot version.
 *
 * @example
 * ```ts
 * registerToolWrapped(
 *   server,
 *   bridge,
 *   "my_tool",
 *   { description: "…", inputSchema: { path: z.string() } },
 *   (input) => handleMyTool(bridge, input),
 *   { godotMinVersion: "4.5", pathParams: [{ param: "path", guard: "project" }] },
 * );
 * ```
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
    versionMap.set(name, { min: opts.godotMinVersion, max: opts.godotMaxVersion });
  }
  if (opts.pathParams != null && opts.pathParams.length > 0) {
    pathParamMap.set(name, opts.pathParams);
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
    const verBounds = versionMap.get(name);
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
    // toolkit's FileGuard (the authoritative boundary); the invariant lives
    // in src/security/pathGuard.ts.
    const guards = pathParamMap.get(name);
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
    const pipeline = opts.hookPipeline ?? globalHookPipeline;
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
 * Bulk-register an array of {@link ToolDef}s, each through
 * {@link registerToolWrapped}. The default handler calls the bridge and
 * JSON-stringifies the result — the path most built-in tool modules follow.
 *
 * @param tools - the tool definitions to register (catalogue order preserved)
 * @param allowedTools - when set, an allowlist: a tool absent from the set is
 *   skipped (the per-module surface filter); omit to register every tool
 * @param opts - `handlers` supplies per-tool overrides for modules with custom
 *   response shaping (screenshots, summary-first) — these still get `successHint`
 *   injection; `hookPipeline` overrides the global pipeline
 *
 * @remarks
 * In read-only mode, tools excluded by their annotations are skipped here — the
 * same gate the live SDK surface enforces.
 */
export function registerTools(
  server: McpServer,
  bridge: Bridge,
  tools: readonly ToolDef[],
  allowedTools?: Set<string>,
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
