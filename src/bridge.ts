import { Bridge, NotificationHandler } from "./types.js";
import { BridgeError } from "./errors.js";
import { createChannel, type Channel } from "./channel.js";
import { createHeartbeat } from "./heartbeat.js";
import { parseGodotVer } from "./version.js";
import type { GodotVer } from "./version.js";
import {
  discoverRuntime,
  lookupProject,
  normalizePath,
  watchRegistry,
  unwatchRegistry,
  isWatcherActive,
  getCachedRuntimePort,
} from "./registry.js";

// `NotificationHandler` now lives in types.ts; re-export it so the public bridge
// surface is byte-stable (importers keep getting it from "./bridge.js").
export type { NotificationHandler } from "./types.js";

// `AuthResponse` now lives in auth_handshake.ts; re-export it so the public
// bridge surface is byte-stable (importers keep getting it from "./bridge.js").
export type { AuthResponse } from "./auth_handshake.js";

// ── Public bridge factory ────────────────────────────────────────────

/** Options for bridge creation. */
export interface BridgeOptions {
  /** Absolute path to the Godot project. Used for registry-based port
   *  discovery (editor + runtime). Falls back to CWD if not set. */
  projectPath?: string;
  /** If set, bypass registry and use this static port for Mode B. */
  explicitRuntimePort?: string | null;
  /** When true, editor URL is static (GODOT_MCP_PORT set). Skips
   *  registry re-discovery on editor connection loss. */
  explicitEditorPort?: boolean;
  /** Max bytes for script content responses (sent to plugin via meta.set_limits). */
  scriptReadLimitBytes?: number;
  /** Max WebSocket buffer size in bytes (sent to plugin via meta.set_limits). */
  wsBufferLimitBytes?: number;
}

export function createBridge(
  editorUrl: string,
  opts?: BridgeOptions,
): Bridge & {
  onNotification(handler: NotificationHandler): void;
  /** Register a one-shot-friendly hook fired when the connected Godot version
   *  resolves (unknown → known). The composition root uses it to complete an
   *  incomplete startup tool surface (concern 071). */
  onGodotVersionKnown(handler: () => void): void;
} {
  const projectPath = opts?.projectPath;
  let godotVersion: string | null = null;
  let notificationHandler: NotificationHandler | null = null;
  let versionKnownHandler: (() => void) | null = null;

  // Record the connected Godot version. Fires the version-resolved hook on the
  // unknown → known transition (and only then) so the composition root can
  // complete a tool surface that was registered before the editor reported its
  // version — version-gated tools (scene_close) and extension tools stranded on
  // a server-before-editor cold start (concern 071). Routing every version-set
  // site through here keeps the unknown → known lifecycle owned in one place.
  function setGodotVersion(v: string): void {
    const versionWasUnknown = godotVersion == null;
    godotVersion = v;
    if (versionWasUnknown && versionKnownHandler) versionKnownHandler();
  }

  // Pre-populate version from registry entry (available before auth).
  if (projectPath) {
    const regEntry = lookupProject(projectPath);
    if (regEntry) {
      const regVer = regEntry.godot_version;
      if (regVer != null && regVer.length > 0) {
        godotVersion = regVer;
      }
    }
  }

  // After auth, push server-side response caps to the plugin so it can
  // enforce them (server env var > dock UI ProjectSettings > defaults).
  function sendLimitsIfConfigured(channel: Channel): void {
    const scriptKb = opts?.scriptReadLimitBytes ? Math.round(opts.scriptReadLimitBytes / 1024) : 0;
    const wsKb = opts?.wsBufferLimitBytes ? Math.round(opts.wsBufferLimitBytes / 1024) : 0;
    if (scriptKb > 0 || wsKb > 0) {
      const params: Record<string, number> = {};
      if (scriptKb > 0) params.script_read_cap_kb = scriptKb;
      if (wsKb > 0) params.ws_buffer_kb = wsKb;
      // Fire-and-forget — failure here is non-fatal.
      channel.call("meta.set_limits", params, 5000).catch(() => {});
    }
  }

  const getNotificationHandler = () => notificationHandler;
  let editor = createChannel(
    editorUrl,
    projectPath,
    (v) => {
      setGodotVersion(v);
      sendLimitsIfConfigured(editor);
    },
    getNotificationHandler,
  );
  let cachedEditorPort = Number(new URL(editorUrl).port);

  // ── Editor-port re-discovery ─────────────────────────────────────
  // When the editor channel fails with CONNECT_FAILED / DISCONNECTED,
  // re-read the registry. If the port changed (plugin restarted on a
  // different port), close the old channel, create a fresh one, and
  // retry the call once. Skipped when the editor port is explicitly set
  // (GODOT_MCP_PORT) or no projectPath is available for registry lookup.
  // TTL prevents thrashing the registry file when the editor is truly
  // unreachable.
  const staticEditor = !!opts?.explicitEditorPort;
  const EDITOR_REDISCOVER_TTL_MS = 5_000;
  let lastRediscoverAt = 0;

  async function rediscoverEditor(): Promise<boolean> {
    if (staticEditor || !projectPath) return false;
    const now = Date.now();
    if (now - lastRediscoverAt < EDITOR_REDISCOVER_TTL_MS) return false;
    lastRediscoverAt = now;
    const entry = lookupProject(projectPath);
    if (!entry) return false;
    if (entry.port === cachedEditorPort) return false;
    const oldPort = cachedEditorPort;
    cachedEditorPort = entry.port;
    await editor.close();
    editor = createChannel(
      `ws://127.0.0.1:${cachedEditorPort}`,
      projectPath,
      (v) => {
        setGodotVersion(v);
      },
      getNotificationHandler,
    );
    process.stderr.write(`[bridge] editor port changed ${oldPort} → ${cachedEditorPort}\n`);
    return true;
  }

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
  let runtimeChannel: Channel | null = opts?.explicitRuntimePort
    ? createRuntimeChannel(opts.explicitRuntimePort)
    : null;
  let cachedRuntimePort: number | null = opts?.explicitRuntimePort ? Number(opts.explicitRuntimePort) : null;

  // ── Runtime-port waiters (for waitForRuntimeConnection) ────────
  // Resolved when onDiscovered fires for this project; timed out by
  // the caller's deadline.  Cleaned up in close().
  type RuntimePortResolver = (port: number | null) => void;
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
    // Load-bearing self-stop guard: callRuntime can null runtimeChannel
    // WITHOUT stopping us (it relies on the next tick seeing this and
    // self-stopping — no failure counted).
    isAlive: () => runtimeChannel !== null,
    onDead: () => {
      process.stderr.write("[bridge] heartbeat failed 4x (~60s) — runtime dead/frozen, clearing\n");
      if (runtimeChannel) {
        void runtimeChannel.close();
        runtimeChannel = null;
        cachedRuntimePort = null;
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
          runtimeChannel = null;
          cachedRuntimePort = null;
        }
      },
    });
  }

  return {
    async call(method, params, timeoutMs, signal) {
      try {
        return await editor.call(method, params, timeoutMs, signal);
      } catch (err) {
        // On editor connection failure, re-read the registry. If the
        // port changed, retry once against the new channel.
        if (err instanceof BridgeError && (err.code === "CONNECT_FAILED" || err.code === "DISCONNECTED")) {
          const changed = await rediscoverEditor();
          if (changed) return editor.call(method, params, timeoutMs, signal);
        }
        throw err;
      }
    },
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
      if (!runtimeChannel && cachedRuntimePort === null) {
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
            runtimeChannel = null;
            cachedRuntimePort = null;
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
          runtimeChannel = null;
          cachedRuntimePort = null;
          throw new BridgeError(
            "GAME_NOT_RUNNING",
            `runtime server on port ${failedPort} is not responding — playtest may have ended`,
          );
        }
        throw err;
      }
    },
    async close() {
      heartbeat.stop();
      // Resolve outstanding runtime-port waiters as null (bridge closing).
      const resolvers = runtimePortResolvers;
      runtimePortResolvers = [];
      for (const resolve of resolvers) resolve(null);

      unwatchRegistry();
      await editor.close();
      if (runtimeChannel) await runtimeChannel.close();
    },
    getGodotVersionString() {
      return godotVersion;
    },
    getGodotVersion(): GodotVer | null {
      if (!godotVersion) return null;
      return parseGodotVer(godotVersion);
    },
    waitForRuntimeConnection(timeoutMs: number): Promise<{ port: number } | null> {
      if (!projectPath) return Promise.resolve(null);
      return new Promise<{ port: number } | null>((resolve) => {
        const timer = setTimeout(() => {
          runtimePortResolvers = runtimePortResolvers.filter((r) => r !== handler);
          resolve(null);
        }, timeoutMs);
        timer.unref?.();

        const handler: RuntimePortResolver = (port) => {
          clearTimeout(timer);
          runtimePortResolvers = runtimePortResolvers.filter((r) => r !== handler);
          resolve(port != null ? { port } : null);
        };
        runtimePortResolvers.push(handler);
      });
    },
    clearRuntime() {
      heartbeat.stop();
      if (runtimeChannel) {
        void runtimeChannel.close();
        runtimeChannel = null;
        cachedRuntimePort = null;
        process.stderr.write("[bridge] runtime cleared (game_stopped notification)\n");
      }
    },
    onNotification(handler: NotificationHandler) {
      notificationHandler = handler;
    },
    onGodotVersionKnown(handler: () => void) {
      versionKnownHandler = handler;
    },
  };
}
