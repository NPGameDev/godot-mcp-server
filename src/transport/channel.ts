/**
 * Reconnecting, authenticating WebSocket with JSON-RPC request/response
 * correlation — the transport Channel primitive.
 *
 * One responsibility: run ONE reliable request/response conversation over a
 * flaky socket — connect, authenticate (re-reading the token every connect),
 * correlate responses to their pending promise by id, reset a pending call's
 * timeout on _queued/_executing progress notifications, and ride out transient
 * drops with exponential backoff (reset on a successful round-trip, not on
 * open). Kept whole: the correlation layer and the connection/reconnect
 * lifecycle co-vary — the backoff reset lives inside the response-correlation
 * path — so they do not separate without a mutual-callback cycle.
 */
import { WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { BridgeError } from "../shared/errors.js";
import { readToken } from "./tokenPath.js";
import { authenticate } from "./authHandshake.js";
import { getServerVersion, compareVersions } from "../shared/version.js";
import type { NotificationHandler } from "../shared/types.js";

// ── Constants ────────────────────────────────────────────────────────

const JSONRPC_VERSION = "2.0";
const DEFAULT_TIMEOUT_MS = 30_000;

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

export interface Channel {
  call(method: string, params?: unknown, timeoutMs?: number, signal?: AbortSignal): Promise<unknown>;
  close(): Promise<void>;
}

type Pending = {
  resolve: (value: unknown) => void;
  reject: (reason: BridgeError) => void;
  timer: NodeJS.Timeout;
  timeoutMs: number;
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

// ── Channel (WebSocket wrapper with reconnect) ───────────────────────

export function createChannel(
  url: string,
  projectPath?: string,
  onAuthResolved?: (info: { version: string; headless: boolean | undefined }) => void,
  onNotification?: () => NotificationHandler | undefined,
  opts?: { noReconnect?: boolean; connectTimeoutMs?: number; skipVersionCheck?: boolean },
): Channel {
  const noReconnect = opts?.noReconnect ?? false;
  const connectTimeout = opts?.connectTimeoutMs ?? 30_000;
  // Skip the server/toolkit version-compat check on the runtime channel — the
  // editor connection runs the authoritative check, and the runtime auth ack
  // carries no version, so re-checking only false-warns about the same plugin.
  const skipVersionCheck = opts?.skipVersionCheck ?? false;
  const pending = new Map<string, Pending>();
  const openWaiters = new Set<Waiter>();
  let ws: WebSocket | undefined = undefined;
  let connectPromise: Promise<WebSocket> | undefined = undefined;
  let reconnectTimer: NodeJS.Timeout | undefined = undefined;
  let attempt = 0;
  let closed = false;
  // Cold vs hot disconnect distinction. Until the first successful open we
  // treat connect failures as terminal (CONNECT_FAILED) so callers like
  // `callRuntime` can map "game never started" to GAME_NOT_RUNNING in ms,
  // not after a 10s reconnect-await ceiling. Once we've connected once we
  // assume the peer exists and ride out transient drops with backoff.
  // When noReconnect is set (runtime channels), disconnect is always terminal.
  let hasConnectedOnce = false;

  /** Send a fire-and-forget JSON-RPC notification to the toolkit (no id, no response). */
  function sendNotification(method: string, params: Record<string, unknown>): void {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ jsonrpc: JSONRPC_VERSION, method, params }));
    }
  }

  /** Cancel an in-flight bridge call: clear its timeout, reject the promise, and
   *  notify the toolkit so cooperative cancellation can bail out early. */
  function cancelPending(id: string): void {
    const pendingRequest = pending.get(id);
    if (pendingRequest) {
      clearTimeout(pendingRequest.timer);
      pendingRequest.reject(new BridgeError("CANCELLED", "Request cancelled by client"));
      pending.delete(id);
    }
    // Always notify toolkit — fire-and-forget even if pending already resolved.
    sendNotification("_cancel", { request_id: id });
  }

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
      reconnectTimer = undefined;
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
      if (authResp.godotVersion && onAuthResolved)
        onAuthResolved({ version: authResp.godotVersion, headless: authResp.headless });
      const verNote = authResp.godotVersion ? ` (Godot ${authResp.godotVersion})` : "";
      process.stderr.write(`[bridge] ${url} authenticated${verNote}\n`);
      // Version mismatch check — human-only (stderr), nothing on MCP wire.
      if (!skipVersionCheck) {
        const serverVer = getServerVersion();
        const severity = compareVersions(serverVer, authResp.toolkitVersion);
        if (severity === "major") {
          process.stderr.write(
            `[bridge] ERROR: major version mismatch — server ${serverVer}, toolkit ${authResp.toolkitVersion}. Update both to the same major version.\n`,
          );
        } else if (severity === "minor") {
          process.stderr.write(
            `[bridge] WARNING: version mismatch — server ${serverVer}, toolkit ${authResp.toolkitVersion}. Consider updating.\n`,
          );
        } else if (severity === "unknown") {
          process.stderr.write(
            `[bridge] WARNING: toolkit did not report version (pre-handshake build?). Consider updating the toolkit plugin.\n`,
          );
        }
      }
      // Notify on reconnect so the server can re-read config.
      if (wasReconnect) {
        onNotification?.()?.("config_reloaded", { reconnect: true });
      }
      resolveAllWaiters(socket);
      resolve(socket);
    } catch (err) {
      ws = undefined;
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
        connectPromise = undefined;
        ws = undefined;
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
        connectPromise = undefined;
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = undefined;
        }
        // Note: attempt is reset on successful message round-trip (below),
        // not on open — open alone isn't proof the peer is healthy. A
        // half-broken peer that accepts then immediately closes the socket
        // would otherwise reset backoff every cycle.
        void performAuth(socket, resolve, reject);
      });
      socket.once("error", (err) => {
        clearTimeout(connectTimer);
        connectPromise = undefined;
        ws = undefined;
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
        // Mutation-queue notifications from the toolkit: reset the pending
        // request's timeout so queued commands don't time out on the sidecar.
        const method = (message as Record<string, unknown>).method as string | undefined;
        if ((method === "_queued" || method === "_executing") && message.id == null) {
          const reqId = String(
            ((message as Record<string, unknown>).params as Record<string, unknown>)?.request_id ?? "",
          );
          const queuedPending = pending.get(reqId);
          if (queuedPending) {
            clearTimeout(queuedPending.timer);
            queuedPending.timer = setTimeout(() => {
              pending.delete(reqId);
              queuedPending.reject(
                new BridgeError("TIMEOUT", `call timed out after ${queuedPending.timeoutMs}ms (post-${method})`),
              );
            }, queuedPending.timeoutMs);
          }
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
        ws = undefined;
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
    async call(method, params = null, timeoutMs = DEFAULT_TIMEOUT_MS, signal?: AbortSignal) {
      if (closed) throw new BridgeError("CLOSED", "channel is closed");
      // Pre-aborted guard: if the signal was already aborted before we start,
      // throw immediately to avoid half-initialized pending state.
      if (signal?.aborted) throw new BridgeError("CANCELLED", "Request already cancelled");
      const socket = ws && ws.readyState === WebSocket.OPEN ? ws : await awaitOpenSocket(CALL_AWAIT_RECONNECT_MS);
      const id = randomUUID();
      const payload = JSON.stringify({ jsonrpc: JSONRPC_VERSION, id, method, params });
      return new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new BridgeError("TIMEOUT", `call to ${method} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer, timeoutMs });
        // Wire up cooperative cancellation: when the MCP client cancels the
        // request, the SDK aborts this signal, which triggers cancelPending.
        signal?.addEventListener("abort", () => cancelPending(id), { once: true });
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
        reconnectTimer = undefined;
      }
      rejectAllPending("CLOSED", "channel closed by caller");
      rejectAllWaiters("CLOSED", "channel closed by caller");
      if (ws && ws.readyState === WebSocket.OPEN) {
        await new Promise<void>((resolve) => {
          ws!.once("close", () => resolve());
          ws!.close();
        });
      }
      ws = undefined;
    },
  };
}
