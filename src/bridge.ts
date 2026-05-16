import { WebSocket } from "ws";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { Bridge } from "./types.js";
import { BridgeError } from "./errors.js";
import {
  discoverRuntime,
  lookupProject,
  normalizePath,
  watchRegistry,
  unwatchRegistry,
  isWatcherActive,
  getCachedRuntimePort,
} from "./registry.js";

// ── Constants ────────────────────────────────────────────────────────

const JSONRPC_VERSION = "2.0";
const DEFAULT_TIMEOUT_MS = 30_000;
const AUTH_TIMEOUT_MS = 5_000;

// Reconnect tuning. 2^6 = 64s clamped to 60s ceiling, so the attempt
// progression is 1, 2, 4, 8, 16, 32, 60, 60, ... seconds. The per-call
// await ceiling (CALL_AWAIT_RECONNECT_MS) bounds how long a fresh call()
// will wait for the bridge to come back before rejecting DISCONNECTED —
// covers the first two backoff rungs (1s + 2s) plus editor-restart
// settle margin.
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 60_000;
const RECONNECT_MAX_ATTEMPT = 6;
const CALL_AWAIT_RECONNECT_MS = 10_000;

// ── Internal types ───────────────────────────────────────────────────

interface Channel {
  call(method: string, params?: unknown, timeoutMs?: number): Promise<unknown>;
  close(): Promise<void>;
}

type Pending = {
  resolve: (value: unknown) => void;
  reject: (reason: BridgeError) => void;
  timer: NodeJS.Timeout;
};

type Waiter = {
  resolve: (ws: WebSocket) => void;
  reject: (err: BridgeError) => void;
  timer: NodeJS.Timeout;
};

type JsonRpcResponse = {
  jsonrpc?: string;
  id?: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
};

/** Unsolicited notification sent by the Godot plugin (no JSON-RPC id). */
type PluginNotification = {
  notification: string;
  params?: Record<string, unknown>;
};

export type NotificationHandler = (type: string, params?: Record<string, unknown>) => void;

// ── Token resolution ─────────────────────────────────────────────────

/**
 * Resolve the Godot project name.
 *
 * Precedence:
 *   1. GODOT_MCP_PROJECT_NAME env var  (set by smoke harness / CI)
 *   2. config/name in project.godot at projectPath (from registry)
 *   3. config/name in project.godot in cwd
 *   4. "[unnamed project]"  (matches Godot's actual appdata dir name)
 */
async function resolveProjectName(projectPath?: string): Promise<string> {
  const envName = process.env.GODOT_MCP_PROJECT_NAME;
  if (envName) return envName;
  // Try the known project directory first, then fall back to cwd.
  const candidates = projectPath ? [join(projectPath, "project.godot"), "project.godot"] : ["project.godot"];
  for (const path of candidates) {
    try {
      const content = await readFile(path, "utf-8");
      const match = content.match(/config\/name="([^"]+)"/);
      if (match) return match[1];
    } catch {
      // Not found at this location — try next.
    }
  }
  return "[unnamed project]";
}

/**
 * Cross-platform Godot user:// path resolution.
 *   win32:  %APPDATA%/Godot/app_userdata/<project>/addons/godot_mcp_toolkit/project_instance_<hash>/mcp_token
 *   darwin: ~/Library/Application Support/Godot/app_userdata/<project>/addons/godot_mcp_toolkit/project_instance_<hash>/mcp_token
 *   linux:  ~/.local/share/godot/app_userdata/<project>/addons/godot_mcp_toolkit/project_instance_<hash>/mcp_token
 *
 * Per-instance: when projectPath is known, the token lives in a hash-named
 * subdirectory matching the plugin's project_paths.gd derivation. Two
 * worktrees of the same repo get distinct directories.
 */
async function resolveTokenPath(projectPath?: string): Promise<string> {
  const envPath = process.env.GODOT_MCP_TOKEN_PATH;
  if (envPath) return envPath;

  const projectName = await resolveProjectName(projectPath);

  // Per-instance: hash the canonical project path so two worktrees of the
  // same repo (same config/name → same user://) get distinct directories.
  // The plugin writes the token to
  //   user://addons/godot_mcp_toolkit/project_instance_<hash>/mcp_token
  // (see project_paths.gd + auth.gd), so the subdir must match here.
  let instanceDir = "addons/godot_mcp_toolkit";
  if (projectPath) {
    let canonical = projectPath.replace(/\\/g, "/").replace(/\/+$/, "");
    // Windows/macOS: lowercase to match GDScript project_paths.gd hash.
    if (process.platform === "win32" || process.platform === "darwin") canonical = canonical.toLowerCase();
    const hash = createHash("sha256").update(canonical).digest("hex").slice(0, 12);
    instanceDir = join("addons", "godot_mcp_toolkit", `project_instance_${hash}`);
  }

  const tokenFile = "mcp_token";

  switch (process.platform) {
    case "win32":
      return join(
        process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"),
        "Godot",
        "app_userdata",
        projectName,
        instanceDir,
        tokenFile,
      );
    case "darwin":
      return join(
        homedir(),
        "Library",
        "Application Support",
        "Godot",
        "app_userdata",
        projectName,
        instanceDir,
        tokenFile,
      );
    default:
      return join(homedir(), ".local", "share", "godot", "app_userdata", projectName, instanceDir, tokenFile);
  }
}

/**
 * Read the session token from disk. Re-reads on every call (no caching) so
 * reconnects after a plugin restart pick up the rotated token.
 */
async function readToken(projectPath?: string): Promise<string> {
  const tokenPath = await resolveTokenPath(projectPath);
  try {
    const token = (await readFile(tokenPath, "utf-8")).trim();
    return token;
  } catch (err) {
    throw new BridgeError("AUTH_FAILED", `cannot read token file at ${tokenPath}: ${(err as Error).message}`);
  }
}

/** Parsed auth response from the Godot plugin. */
export interface AuthResponse {
  godotVersion: string | null;
  profile?: string;
  gates?: Record<string, boolean>;
}

/**
 * Send the auth handshake and wait for {"authed": true} or a close frame.
 * Resolves with the full auth response including optional gate state.
 */
function authenticate(ws: WebSocket, token: string): Promise<AuthResponse> {
  return new Promise<AuthResponse>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new BridgeError("AUTH_FAILED", "auth handshake timed out"));
    }, AUTH_TIMEOUT_MS);

    function cleanup(): void {
      clearTimeout(timer);
      ws.removeListener("message", onMessage);
      ws.removeListener("close", onClose);
    }

    function onMessage(data: unknown): void {
      try {
        const msg = JSON.parse(String(data)) as {
          authed?: boolean;
          godot_version?: string;
          profile?: string;
          gates?: Record<string, boolean>;
        };
        if (msg.authed === true) {
          cleanup();
          resolve({
            godotVersion: msg.godot_version ?? null,
            profile: msg.profile,
            gates: msg.gates,
          });
        }
      } catch {
        // Not JSON — ignore, keep waiting.
      }
    }

    function onClose(_code: number, reason: Buffer): void {
      cleanup();
      reject(new BridgeError("AUTH_FAILED", `server closed connection during auth: ${reason.toString()}`));
    }

    ws.on("message", onMessage);
    ws.on("close", onClose);
    ws.send(JSON.stringify({ auth: token }));
  });
}

// ── Channel (WebSocket wrapper with reconnect) ───────────────────────

function createChannel(
  url: string,
  projectPath?: string,
  onGodotVersion?: (version: string) => void,
  onNotification?: () => NotificationHandler | null,
  opts?: { noReconnect?: boolean; connectTimeoutMs?: number },
): Channel {
  const noReconnect = opts?.noReconnect ?? false;
  const connectTimeout = opts?.connectTimeoutMs ?? 30_000;
  const pending = new Map<string, Pending>();
  const openWaiters = new Set<Waiter>();
  let ws: WebSocket | null = null;
  let connectPromise: Promise<WebSocket> | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let attempt = 0;
  let closed = false;
  // Cold vs hot disconnect distinction. Until the first successful open we
  // treat connect failures as terminal (CONNECT_FAILED) so callers like
  // `callRuntime` can map "game never started" to GAME_NOT_RUNNING in ms,
  // not after a 10s reconnect-await ceiling. Once we've connected once we
  // assume the peer exists and ride out transient drops with backoff.
  // When noReconnect is set (runtime channels), disconnect is always terminal.
  let hasConnectedOnce = false;

  function rejectAllPending(code: string, message: string): void {
    for (const [id, pendingRequest] of pending) {
      clearTimeout(pendingRequest.timer);
      pendingRequest.reject(new BridgeError(code, message));
      pending.delete(id);
    }
  }

  function resolveAllWaiters(socket: WebSocket): void {
    for (const waiter of openWaiters) {
      clearTimeout(waiter.timer);
      waiter.resolve(socket);
    }
    openWaiters.clear();
  }

  function rejectAllWaiters(code: string, message: string): void {
    for (const waiter of openWaiters) {
      clearTimeout(waiter.timer);
      waiter.reject(new BridgeError(code, message));
    }
    openWaiters.clear();
  }

  function scheduleReconnect(): void {
    if (closed) return;
    // Runtime channels (noReconnect): game is dead, don't try again.
    // Reject all waiters immediately so callers get DISCONNECTED fast.
    if (noReconnect) {
      rejectAllWaiters("DISCONNECTED", `${url} disconnected (no reconnect — runtime channel)`);
      return;
    }
    if (reconnectTimer) return;
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attempt);
    attempt = Math.min(attempt + 1, RECONNECT_MAX_ATTEMPT);
    process.stderr.write(`[bridge] ${url} disconnected; reconnect in ${delay}ms (attempt ${attempt})\n`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (closed) return;
      // Failure path schedules the next attempt itself via socket.error.
      void connect().catch(() => {});
    }, delay);
    reconnectTimer.unref?.();
  }

  /** Authenticate after the socket opens, then resolve the connect promise. */
  async function performAuth(
    socket: WebSocket,
    resolve: (ws: WebSocket) => void,
    reject: (err: BridgeError) => void,
  ): Promise<void> {
    const wasReconnect = hasConnectedOnce;
    process.stderr.write(`[bridge] ${url} ${wasReconnect ? "reconnected" : "connected"}, authenticating…\n`);
    try {
      // Re-read token from disk on every connect (including reconnects)
      // so rotated tokens after a plugin restart are picked up.
      const token = await readToken(projectPath);
      const authResp = await authenticate(socket, token);
      hasConnectedOnce = true;
      if (authResp.godotVersion && onGodotVersion) onGodotVersion(authResp.godotVersion);
      const verNote = authResp.godotVersion ? ` (Godot ${authResp.godotVersion})` : "";
      process.stderr.write(`[bridge] ${url} authenticated${verNote}\n`);
      // Always notify with auth-delivered gate state so the server can
      // update its tool registration. On reconnect this replaces the
      // previous re-read-.mcp.json flow; on first connect it applies
      // the plugin's current gates (which may differ from env vars).
      if (wasReconnect || authResp.gates) {
        onNotification?.()?.("config_reloaded", {
          reconnect: wasReconnect,
          ...(authResp.profile != null && { profile: authResp.profile }),
          ...(authResp.gates != null && { gates: authResp.gates }),
        });
      }
      resolveAllWaiters(socket);
      resolve(socket);
    } catch (err) {
      ws = null;
      socket.close();
      const error = err instanceof BridgeError ? err : new BridgeError("AUTH_FAILED", (err as Error).message);
      rejectAllWaiters(error.code, error.message);
      reject(error);
      if (!closed) scheduleReconnect();
    }
  }

  function connect(): Promise<WebSocket> {
    if (ws && ws.readyState === WebSocket.OPEN) return Promise.resolve(ws);
    if (connectPromise) return connectPromise;
    connectPromise = new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(url);
      ws = socket;
      // Connection timeout: if neither `open` nor `error` fires within the
      // deadline, tear down the attempt. Without this, connect() hangs
      // indefinitely. Editor channels use 30s (slow startups); runtime
      // channels use 10s (game is either there or dead).
      const connectTimer = setTimeout(() => {
        connectPromise = null;
        ws = null;
        socket.removeAllListeners();
        socket.close();
        const error = new BridgeError(
          "CONNECT_FAILED",
          `WebSocket connection to ${url} timed out (${connectTimeout / 1000}s)`,
        );
        scheduleReconnect();
        reject(error);
      }, connectTimeout);
      connectTimer.unref?.();
      socket.once("open", () => {
        clearTimeout(connectTimer);
        connectPromise = null;
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        // Note: attempt is reset on successful message round-trip (below),
        // not on open — open alone isn't proof the peer is healthy. A
        // half-broken peer that accepts then immediately closes the socket
        // would otherwise reset backoff every cycle.
        void performAuth(socket, resolve, reject);
      });
      socket.once("error", (err) => {
        clearTimeout(connectTimer);
        connectPromise = null;
        ws = null;
        const error = new BridgeError("CONNECT_FAILED", `WebSocket error: ${(err as Error).message}`);
        // Hot path: keep waiters alive across this failure — they'll either
        // be picked up by a later successful reconnect or hit their per-call
        // 10s timer. Cold path: the connect()'s rejection here propagates
        // through awaitOpenSocket → call() so callers see CONNECT_FAILED.
        scheduleReconnect();
        reject(error);
      });
      socket.on("message", (data) => {
        let message: JsonRpcResponse & Partial<PluginNotification>;
        try {
          message = JSON.parse(data.toString()) as JsonRpcResponse & Partial<PluginNotification>;
        } catch {
          return;
        }
        // Plugin notification (no JSON-RPC id, has notification field).
        if (message.notification && message.id == null) {
          process.stderr.write(`[godot-mcp] plugin notification: ${message.notification}\n`);
          onNotification?.()?.(message.notification, message.params);
          return;
        }
        const id = message.id;
        if (id == null) return;
        const key = String(id);
        const pendingRequest = pending.get(key);
        if (!pendingRequest) return;
        clearTimeout(pendingRequest.timer);
        pending.delete(key);
        // Reset backoff on successful round-trip.
        attempt = 0;
        if (message.error) {
          pendingRequest.reject(new BridgeError("RPC_ERROR", `${message.error.code}: ${message.error.message}`));
        } else {
          pendingRequest.resolve(message.result);
        }
      });
      socket.on("close", () => {
        ws = null;
        rejectAllPending("DISCONNECTED", "WebSocket closed before response");
        // Auto-reconnect unless the user explicitly closed us.
        if (!closed) scheduleReconnect();
      });
    });
    return connectPromise;
  }

  function awaitOpenSocket(maxMs: number): Promise<WebSocket> {
    if (ws && ws.readyState === WebSocket.OPEN) return Promise.resolve(ws);
    // Cold path: never been connected. Surface failure immediately so
    // GAME_NOT_RUNNING / first-call-against-dead-editor stay snappy.
    if (!hasConnectedOnce) return connect();
    // Hot path: was connected, dropped. Wait up to maxMs for either an
    // in-flight reconnect to succeed or our timer to fire DISCONNECTED.
    return new Promise<WebSocket>((resolve, reject) => {
      const timer = setTimeout(() => {
        openWaiters.delete(waiter);
        reject(new BridgeError("DISCONNECTED", `no connection to ${url} after ${maxMs}ms`));
      }, maxMs);
      const waiter: Waiter = { resolve, reject, timer };
      openWaiters.add(waiter);
      // If neither a connect attempt nor a backoff timer is in flight,
      // kick off a connect now. Otherwise the existing one will eventually
      // call resolveAllWaiters or scheduleReconnect.
      if (!connectPromise && !reconnectTimer) {
        void connect().catch(() => {});
      }
    });
  }

  return {
    async call(method, params = null, timeoutMs = DEFAULT_TIMEOUT_MS) {
      if (closed) throw new BridgeError("CLOSED", "channel is closed");
      const socket = ws && ws.readyState === WebSocket.OPEN ? ws : await awaitOpenSocket(CALL_AWAIT_RECONNECT_MS);
      const id = randomUUID();
      const payload = JSON.stringify({ jsonrpc: JSONRPC_VERSION, id, method, params });
      return new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new BridgeError("TIMEOUT", `call to ${method} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        socket.send(payload, (err) => {
          if (err) {
            const pendingRequest = pending.get(id);
            if (pendingRequest) {
              clearTimeout(pendingRequest.timer);
              pending.delete(id);
              reject(new BridgeError("SEND_FAILED", err.message));
            }
          }
        });
      });
    },
    async close() {
      closed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      rejectAllPending("CLOSED", "channel closed by caller");
      rejectAllWaiters("CLOSED", "channel closed by caller");
      if (ws && ws.readyState === WebSocket.OPEN) {
        await new Promise<void>((resolve) => {
          ws!.once("close", () => resolve());
          ws!.close();
        });
      }
      ws = null;
    },
  };
}

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
): Bridge & { onNotification(handler: NotificationHandler): void } {
  const projectPath = opts?.projectPath;
  let godotVersion: string | null = null;
  let notificationHandler: NotificationHandler | null = null;

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
      godotVersion = v;
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
        godotVersion = v;
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
  let runtimeChannel: Channel | null = opts?.explicitRuntimePort
    ? createChannel(`ws://127.0.0.1:${opts.explicitRuntimePort}`, projectPath, undefined, undefined, {
        noReconnect: true,
        connectTimeoutMs: 10_000,
      })
    : null;
  let cachedRuntimePort: number | null = opts?.explicitRuntimePort ? Number(opts.explicitRuntimePort) : null;

  // ── Runtime-port waiters (for waitForRuntimeConnection) ────────
  // Resolved when onDiscovered fires for this project; timed out by
  // the caller's deadline.  Cleaned up in close().
  type RuntimePortResolver = (port: number | null) => void;
  let runtimePortResolvers: RuntimePortResolver[] = [];

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
        runtimeChannel = createChannel(`ws://127.0.0.1:${port}`, projectPath, undefined, undefined, {
          noReconnect: true,
          connectTimeoutMs: 10_000,
        });
        cachedRuntimePort = port;
        startHeartbeat();
        // Notify any pending waitForRuntimeConnection callers.
        const resolvers = runtimePortResolvers;
        runtimePortResolvers = [];
        for (const resolve of resolvers) resolve(port);
      },
      onRemoved: (removedPath) => {
        if (removedPath !== normalizedProject) return;
        process.stderr.write(`[bridge] runtime removed\n`);
        stopHeartbeat();
        if (runtimeChannel) {
          void runtimeChannel.close();
          runtimeChannel = null;
          cachedRuntimePort = null;
        }
      },
    });
  }

  // ── Runtime heartbeat (frozen-game detection) ───────────────────
  // Pings the runtime every 15s with a 10s timeout. Four consecutive
  // failures (~60s unresponsive) → proactive teardown. The generous
  // threshold avoids false positives on poorly-optimized games running
  // at very low FPS. True freezes (infinite loop) will never respond.
  let heartbeatInterval: NodeJS.Timeout | null = null;
  let heartbeatFailures = 0;

  function startHeartbeat(): void {
    if (heartbeatInterval) return;
    heartbeatFailures = 0;
    heartbeatInterval = setInterval(async () => {
      if (!runtimeChannel) {
        stopHeartbeat();
        return;
      }
      try {
        await runtimeChannel.call("ping", null, 10_000);
        heartbeatFailures = 0;
      } catch {
        heartbeatFailures++;
        if (heartbeatFailures >= 4) {
          process.stderr.write("[bridge] heartbeat failed 4x (~60s) — runtime dead/frozen, clearing\n");
          if (runtimeChannel) {
            void runtimeChannel.close();
            runtimeChannel = null;
            cachedRuntimePort = null;
          }
          stopHeartbeat();
        }
      }
    }, 15_000);
    heartbeatInterval.unref?.();
  }

  function stopHeartbeat(): void {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
    heartbeatFailures = 0;
  }

  return {
    async call(method, params, timeoutMs) {
      try {
        return await editor.call(method, params, timeoutMs);
      } catch (err) {
        // On editor connection failure, re-read the registry. If the
        // port changed, retry once against the new channel.
        if (err instanceof BridgeError && (err.code === "CONNECT_FAILED" || err.code === "DISCONNECTED")) {
          const changed = await rediscoverEditor();
          if (changed) return editor.call(method, params, timeoutMs);
        }
        throw err;
      }
    },
    async callRuntime(method, params, timeoutMs) {
      // Static port override — same as explicit-port behaviour.
      if (opts?.explicitRuntimePort) {
        try {
          return await runtimeChannel!.call(method, params, timeoutMs);
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
        runtimeChannel = createChannel(`ws://127.0.0.1:${diskPort}`, projectPath, undefined, undefined, {
          noReconnect: true,
          connectTimeoutMs: 10_000,
        });
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
          runtimeChannel = createChannel(`ws://127.0.0.1:${currentPort}`, projectPath, undefined, undefined, {
            noReconnect: true,
            connectTimeoutMs: 10_000,
          });
          cachedRuntimePort = currentPort;
        }
      }

      try {
        return await runtimeChannel!.call(method, params, timeoutMs);
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
      stopHeartbeat();
      // Resolve outstanding runtime-port waiters as null (bridge closing).
      const resolvers = runtimePortResolvers;
      runtimePortResolvers = [];
      for (const resolve of resolvers) resolve(null);

      unwatchRegistry();
      await editor.close();
      if (runtimeChannel) await runtimeChannel.close();
    },
    getGodotVersion() {
      return godotVersion;
    },
    getGodotMinor() {
      if (!godotVersion) return null;
      const parts = godotVersion.split(".");
      return parts.length >= 2 ? Number(parts[1]) : null;
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
      stopHeartbeat();
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
  };
}
