/**
 * The playtest runtime-connection aggregate.
 *
 * Owns the ephemeral playtest channel and everything that keeps it consistent —
 * the (runtimeChannel, cachedRuntimePort) pair, the registry watcher that
 * auto-connects/tears-down on playtest start/stop, the port-waiters that
 * waitForRuntimeConnection parks on, and a composed heartbeat that proactively
 * clears a frozen game. One reason to change: the runtime-process connection
 * lifecycle (discover → connect → watch-for-freeze → tear down a playtest
 * channel). It touches neither version state nor notification routing — that is
 * why it carves cleanly out of the composition root.
 *
 * The channel primitive, the heartbeat primitive, and the six registry reader
 * fns are injected through an optional `deps` seam (production default = the
 * real imports) so the aggregate is unit-testable in isolation with fakes. The
 * seam destructures `deps ?? REAL` at the top into the same bare names the
 * bodies reference.
 *
 * Deps: channel (createChannel, Channel), heartbeat (createHeartbeat), registry
 * (six reader fns), errors (BridgeError). The composition root (bridge.ts)
 * constructs one createRuntimeConnection and delegates its callRuntime /
 * waitForRuntimeConnection / clearRuntime facade methods to it.
 */
import { createChannel as realCreateChannel, type Channel } from "./channel.js";
import { createHeartbeat as realCreateHeartbeat } from "./heartbeat.js";
import * as realRegistry from "../registry.js";
import { BridgeError } from "../shared/errors.js";

/** The runtime-connection facade the composition root delegates to. */
export interface RuntimeConnection {
  callRuntime(method: string, params?: unknown, timeoutMs?: number, signal?: AbortSignal): Promise<unknown>;
  waitForRuntimeConnection(timeoutMs: number): Promise<{ port: number } | undefined>;
  clearRuntime(): void;
  close(): Promise<void>;
}

/**
 * Injectable collaborators. Production passes nothing (the real imports are the
 * default); the unit test injects fakes to isolate the aggregate from the real
 * channel/heartbeat/registry. The `registry` slice is ISP-narrowed (via Pick) to
 * the exact six reader fns the aggregate uses.
 */
export interface RuntimeConnectionDeps {
  createChannel: typeof realCreateChannel;
  createHeartbeat: typeof realCreateHeartbeat;
  registry: Pick<
    typeof import("../registry.js"),
    | "discoverRuntime"
    | "normalizePath"
    | "watchRegistry"
    | "unwatchRegistry"
    | "isWatcherActive"
    | "getCachedRuntimePort"
  >;
}

export function createRuntimeConnection(
  opts: { projectPath?: string; explicitRuntimePort?: string | undefined },
  deps?: RuntimeConnectionDeps,
): RuntimeConnection {
  // DI seam: destructure the injected (or real) collaborators into the same
  // bare names the bodies reference. The real imports are aliased (real*) so
  // this default object can name them without shadowing the destructured locals
  // (a temporal-dead-zone hazard otherwise).
  const { createChannel, createHeartbeat, registry }: RuntimeConnectionDeps = deps ?? {
    createChannel: realCreateChannel,
    createHeartbeat: realCreateHeartbeat,
    registry: realRegistry,
  };
  const { discoverRuntime, normalizePath, watchRegistry, unwatchRegistry, isWatcherActive, getCachedRuntimePort } =
    registry;

  const projectPath = opts.projectPath;

  // ── Runtime channel management ───────────────────────────────────
  // When an explicit port is set, create a static channel. Otherwise,
  // callRuntime re-reads the registry on each invocation to pick up
  // newly-started playtests. The channel is cached and recreated only
  // when the port changes.
  // Single construction point for all runtime channels (no reconnect, 10s connect timeout).
  const createRuntimeChannel = (port: number | string): Channel =>
    createChannel(`ws://127.0.0.1:${port}`, projectPath, undefined, undefined, {
      noReconnect: true,
      connectTimeoutMs: 10_000,
    });
  let runtimeChannel: Channel | undefined = opts?.explicitRuntimePort
    ? createRuntimeChannel(opts.explicitRuntimePort)
    : undefined;
  let cachedRuntimePort: number | undefined = opts?.explicitRuntimePort ? Number(opts.explicitRuntimePort) : undefined;

  // ── Runtime-port waiters (for waitForRuntimeConnection) ────────
  // Resolved when onDiscovered fires for this project; timed out by
  // the caller's deadline.  Cleaned up in close().
  type RuntimePortResolver = (port: number | undefined) => void;
  let runtimePortResolvers: RuntimePortResolver[] = [];

  // ── Runtime heartbeat (frozen-game detection) ───────────────────
  // Pings the runtime every 15s with a 10s timeout. Four consecutive
  // failures (~60s unresponsive) → proactive teardown. The generous
  // threshold avoids false positives on poorly-optimized games running
  // at very low FPS. True freezes (infinite loop) will never respond.
  // The generic timer/threshold policy lives in heartbeat.ts; the
  // runtime-state probe + teardown are injected here.
  const heartbeat = createHeartbeat({
    // The probe bakes its own 10s timeout (the channel call self-rejects at
    // 10s), so createHeartbeat runs no timeout race of its own.
    ping: () => runtimeChannel!.call("ping", null, 10_000),
    // Load-bearing self-stop guard: callRuntime can clear runtimeChannel
    // WITHOUT stopping us (it relies on the next tick seeing this and
    // self-stopping — no failure counted).
    isAlive: () => runtimeChannel !== undefined,
    onDead: () => {
      process.stderr.write("[bridge] heartbeat failed 4x (~60s) — runtime dead/frozen, clearing\n");
      if (runtimeChannel) {
        void runtimeChannel.close();
        runtimeChannel = undefined;
        cachedRuntimePort = undefined;
      }
    },
    intervalMs: 15_000,
    maxFailures: 4,
  });

  // ── Registry watcher for instant runtime discovery ─────────────
  // fs.watch on projects.json auto-connects to new runtime ports and
  // tears down stale channels. Replaces per-RPC file reads in
  // callRuntime with in-memory lookups (Path A). Falls back to
  // per-RPC reads when fs.watch is unavailable (Path B).
  if (projectPath && !opts?.explicitRuntimePort) {
    const normalizedProject = normalizePath(projectPath);
    watchRegistry({
      onDiscovered: (discoveredPath, port) => {
        if (discoveredPath !== normalizedProject) return;
        process.stderr.write(`[bridge] runtime discovered on port ${port}\n`);
        if (runtimeChannel) void runtimeChannel.close();
        runtimeChannel = createRuntimeChannel(port);
        cachedRuntimePort = port;
        heartbeat.start();
        // Notify any pending waitForRuntimeConnection callers.
        const resolvers = runtimePortResolvers;
        runtimePortResolvers = [];
        for (const resolve of resolvers) resolve(port);
      },
      onRemoved: (removedPath) => {
        if (removedPath !== normalizedProject) return;
        process.stderr.write(`[bridge] runtime removed\n`);
        heartbeat.stop();
        if (runtimeChannel) {
          void runtimeChannel.close();
          runtimeChannel = undefined;
          cachedRuntimePort = undefined;
        }
      },
    });
  }

  return {
    async callRuntime(method, params, timeoutMs, signal) {
      // Static port override — same as explicit-port behaviour.
      if (opts?.explicitRuntimePort) {
        try {
          return await runtimeChannel!.call(method, params, timeoutMs, signal);
        } catch (err) {
          if (err instanceof BridgeError && (err.code === "CONNECT_FAILED" || err.code === "DISCONNECTED")) {
            throw new BridgeError(
              "GAME_NOT_RUNNING",
              `no runtime server on 127.0.0.1:${opts.explicitRuntimePort} — start the game in the editor (F5) with a debug build`,
            );
          }
          throw err;
        }
      }

      // Registry-based discovery.
      if (!projectPath) {
        throw new BridgeError("GAME_NOT_RUNNING", "no runtime port configured and no project path for registry lookup");
      }

      // Fast path: if clearRuntime() was called (game_stopped notification),
      // trust it over the potentially-stale registry cache. The registry
      // watcher has a 100ms debounce — during that window getCachedRuntimePort
      // still returns the old port. Don't create a doomed channel to it.
      if (!runtimeChannel && cachedRuntimePort === undefined) {
        const freshPort = isWatcherActive() ? getCachedRuntimePort(projectPath) : discoverRuntime(projectPath);
        if (freshPort === null) {
          throw new BridgeError(
            "GAME_NOT_RUNNING",
            "no runtime_port in registry — start the game in the editor (F5) with a debug build",
          );
        }
        // Registry still has a port — either watcher is stale (race) or a new
        // game started before we ran. Re-read the file to break the debounce.
        const diskPort = discoverRuntime(projectPath);
        if (diskPort === null) {
          throw new BridgeError(
            "GAME_NOT_RUNNING",
            "game stopped (runtime cleared by notification, registry not yet updated)",
          );
        }
        // Disk confirms a port exists — new game started. Create channel.
        runtimeChannel = createRuntimeChannel(diskPort);
        cachedRuntimePort = diskPort;
      } else {
        // Normal path: consult registry cache.
        const currentPort = isWatcherActive() ? getCachedRuntimePort(projectPath) : discoverRuntime(projectPath);
        if (currentPort === null) {
          // No playtest running — close stale channel and reject immediately.
          if (runtimeChannel) {
            await runtimeChannel.close();
            runtimeChannel = undefined;
            cachedRuntimePort = undefined;
          }
          throw new BridgeError(
            "GAME_NOT_RUNNING",
            "no runtime_port in registry — start the game in the editor (F5) with a debug build",
          );
        }

        // Port changed (new playtest or different runtime instance).
        if (currentPort !== cachedRuntimePort) {
          if (runtimeChannel) await runtimeChannel.close();
          runtimeChannel = createRuntimeChannel(currentPort);
          cachedRuntimePort = currentPort;
        }
      }

      try {
        return await runtimeChannel!.call(method, params, timeoutMs, signal);
      } catch (err) {
        if (err instanceof BridgeError && (err.code === "CONNECT_FAILED" || err.code === "DISCONNECTED")) {
          const failedPort = cachedRuntimePort;
          await runtimeChannel!.close();
          runtimeChannel = undefined;
          cachedRuntimePort = undefined;
          throw new BridgeError(
            "GAME_NOT_RUNNING",
            `runtime server on port ${failedPort} is not responding — playtest may have ended`,
          );
        }
        throw err;
      }
    },
    waitForRuntimeConnection(timeoutMs: number): Promise<{ port: number } | undefined> {
      if (!projectPath) return Promise.resolve(undefined);
      return new Promise<{ port: number } | undefined>((resolve) => {
        const timer = setTimeout(() => {
          runtimePortResolvers = runtimePortResolvers.filter((r) => r !== handler);
          resolve(undefined);
        }, timeoutMs);
        timer.unref?.();

        const handler: RuntimePortResolver = (port) => {
          clearTimeout(timer);
          runtimePortResolvers = runtimePortResolvers.filter((r) => r !== handler);
          resolve(port != null ? { port } : undefined);
        };
        runtimePortResolvers.push(handler);
      });
    },
    clearRuntime() {
      heartbeat.stop();
      if (runtimeChannel) {
        void runtimeChannel.close();
        runtimeChannel = undefined;
        cachedRuntimePort = undefined;
        process.stderr.write("[bridge] runtime cleared (game_stopped notification)\n");
      }
    },
    async close() {
      heartbeat.stop();
      // Resolve outstanding runtime-port waiters as undefined (bridge closing).
      const resolvers = runtimePortResolvers;
      runtimePortResolvers = [];
      for (const resolve of resolvers) resolve(undefined);

      unwatchRegistry();
      if (runtimeChannel) await runtimeChannel.close();
    },
  };
}
