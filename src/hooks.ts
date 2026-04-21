/**
 * Middleware pipeline for MCP tool dispatch.
 *
 * Each hook wraps the tool handler in an onion-style chain:
 *   hook1( hook2( handler ) )
 * Hooks execute in registration order (outermost first).
 */
import type { Hook, ToolRequest, ToolTextResult } from "./types.js";

export class HookPipeline {
  private hooks: Hook[] = [];

  /** Register a hook. Hooks fire in registration order (FIFO). */
  use(hook: Hook): void {
    this.hooks.push(hook);
  }

  /**
   * Execute the hook chain around a tool handler.
   * If any hook throws, the error is caught and logged — dispatch
   * continues with the remaining chain so one misbehaving hook
   * cannot break all tool calls.
   */
  async execute(
    req: ToolRequest,
    handler: () => Promise<ToolTextResult>,
  ): Promise<ToolTextResult> {
    let chain = handler;
    // Build chain from innermost (last hook) to outermost (first hook).
    for (let i = this.hooks.length - 1; i >= 0; i--) {
      const hook = this.hooks[i];
      const next = chain;
      chain = async () => {
        try {
          return await hook(req, next);
        } catch (err) {
          process.stderr.write(
            `[godot-mcp] hook error: ${(err as Error).message}\n`,
          );
          return next();
        }
      };
    }
    return chain();
  }

  get length(): number {
    return this.hooks.length;
  }
}

// ── Seed hooks ─────────────────────────────────────────────────────────

/** Logging hook — writes tool name + duration to stderr. */
export function loggingHook(): Hook {
  return async (req, next) => {
    const start = Date.now();
    const result = await next();
    const ms = Date.now() - start;
    process.stderr.write(
      `[godot-mcp] tool=${req.name} duration=${ms}ms isError=${!!result.isError}\n`,
    );
    return result;
  };
}

/**
 * Rate-limit hook — rejects calls that exceed `maxPerWindow` within
 * `windowMs`. Disabled when `maxPerWindow` is 0 (default).
 */
export function rateLimitHook(
  maxPerWindow: number = 0,
  windowMs: number = 60_000,
): Hook | null {
  if (maxPerWindow <= 0) return null;
  const timestamps: number[] = [];
  return async (_req, next) => {
    const now = Date.now();
    while (timestamps.length > 0 && timestamps[0] <= now - windowMs) {
      timestamps.shift();
    }
    if (timestamps.length >= maxPerWindow) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: `Rate limit exceeded (${maxPerWindow} calls per ${windowMs / 1000}s)`,
              code: "RATE_LIMITED",
            }),
          },
        ],
        isError: true,
      };
    }
    timestamps.push(now);
    return next();
  };
}

/** Create a pre-configured pipeline with seed hooks. */
export function createHookPipeline(): HookPipeline {
  const pipeline = new HookPipeline();
  // Logging is always on (writes to stderr, low cost).
  pipeline.use(loggingHook());
  // Rate limiting off by default; users can set GODOT_MCP_RATE_LIMIT.
  const limit = Number(process.env.GODOT_MCP_RATE_LIMIT ?? "0");
  const rlHook = rateLimitHook(limit);
  if (rlHook) pipeline.use(rlHook);
  return pipeline;
}
