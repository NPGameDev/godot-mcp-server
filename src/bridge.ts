import { WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { Bridge, BridgeError } from "./types.js";

const JSONRPC_VERSION = "2.0";
const DEFAULT_TIMEOUT_MS = 30_000;

// Reconnect tuning (iter 13). 2^6 = 64s clamped to 60s ceiling, so the
// attempt progression is 1, 2, 4, 8, 16, 32, 60, 60, ... seconds. The
// per-call await ceiling (CALL_AWAIT_RECONNECT_MS) bounds how long a
// fresh call() will wait for the bridge to come back before rejecting
// DISCONNECTED — covers the first two backoff rungs (1s + 2s) plus
// editor-restart settle margin.
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 60_000;
const RECONNECT_MAX_ATTEMPT = 6;
const CALL_AWAIT_RECONNECT_MS = 10_000;

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

interface Channel {
  call(method: string, params?: unknown, timeoutMs?: number): Promise<unknown>;
  close(): Promise<void>;
}

function createChannel(url: string): Channel {
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
  let hasConnectedOnce = false;

  function rejectAllPending(code: string, message: string): void {
    for (const [id, p] of pending) {
      clearTimeout(p.timer);
      p.reject(new BridgeError(code, message));
      pending.delete(id);
    }
  }

  function resolveAllWaiters(socket: WebSocket): void {
    for (const w of openWaiters) {
      clearTimeout(w.timer);
      w.resolve(socket);
    }
    openWaiters.clear();
  }

  function rejectAllWaiters(code: string, message: string): void {
    for (const w of openWaiters) {
      clearTimeout(w.timer);
      w.reject(new BridgeError(code, message));
    }
    openWaiters.clear();
  }

  function scheduleReconnect(): void {
    if (closed) return;
    if (reconnectTimer) return;
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * (2 ** attempt));
    attempt = Math.min(attempt + 1, RECONNECT_MAX_ATTEMPT);
    process.stderr.write(
      `[bridge] ${url} disconnected; reconnect in ${delay}ms (attempt ${attempt})\n`,
    );
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (closed) return;
      // Failure path schedules the next attempt itself via socket.error.
      void connect().catch(() => {});
    }, delay);
    reconnectTimer.unref?.();
  }

  function connect(): Promise<WebSocket> {
    if (ws && ws.readyState === WebSocket.OPEN) return Promise.resolve(ws);
    if (connectPromise) return connectPromise;
    connectPromise = new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(url);
      ws = socket;
      socket.once("open", () => {
        connectPromise = null;
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        const wasReconnect = hasConnectedOnce;
        hasConnectedOnce = true;
        // Note: attempt is reset on successful message round-trip (below),
        // not on open — open alone isn't proof the peer is healthy. A
        // half-broken peer that accepts then immediately closes the socket
        // would otherwise reset backoff every cycle.
        process.stderr.write(`[bridge] ${url} ${wasReconnect ? "reconnected" : "connected"}\n`);
        resolveAllWaiters(socket);
        resolve(socket);
      });
      socket.once("error", (err) => {
        connectPromise = null;
        ws = null;
        const error = new BridgeError(
          "CONNECT_FAILED",
          `WebSocket error: ${(err as Error).message}`,
        );
        // Hot path: keep waiters alive across this failure — they'll either
        // be picked up by a later successful reconnect or hit their per-call
        // 10s timer. Cold path: the connect()'s rejection here propagates
        // through awaitOpenSocket → call() so callers see CONNECT_FAILED.
        scheduleReconnect();
        reject(error);
      });
      socket.on("message", (data) => {
        let msg: JsonRpcResponse;
        try {
          msg = JSON.parse(data.toString()) as JsonRpcResponse;
        } catch {
          return;
        }
        const id = msg.id;
        if (id == null) return;
        const key = String(id);
        const p = pending.get(key);
        if (!p) return;
        clearTimeout(p.timer);
        pending.delete(key);
        // Reset backoff on successful round-trip (per iter-13 step 1).
        attempt = 0;
        if (msg.error) {
          p.reject(new BridgeError("RPC_ERROR", `${msg.error.code}: ${msg.error.message}`));
        } else {
          p.resolve(msg.result);
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
      const socket =
        ws && ws.readyState === WebSocket.OPEN
          ? ws
          : await awaitOpenSocket(CALL_AWAIT_RECONNECT_MS);
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
            const p = pending.get(id);
            if (p) {
              clearTimeout(p.timer);
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

export function createBridge(editorUrl: string, runtimeUrl?: string): Bridge {
  const editor = createChannel(editorUrl);
  // Runtime channel is created lazily so dogfood calls that never touch
  // Mode B don't pay a failed-connect cost at startup. `callRuntime`
  // translates the channel's CONNECT_FAILED / DISCONNECTED into
  // GAME_NOT_RUNNING so the MCP tool layer can surface a clean,
  // actionable error.
  const runtime = runtimeUrl ? createChannel(runtimeUrl) : null;

  return {
    call(method, params, timeoutMs) {
      return editor.call(method, params, timeoutMs);
    },
    async callRuntime(method, params, timeoutMs) {
      if (!runtime) {
        throw new BridgeError(
          "NO_RUNTIME_URL",
          "runtime URL not configured; pass a second arg to createBridge()",
        );
      }
      try {
        return await runtime.call(method, params, timeoutMs);
      } catch (err) {
        if (err instanceof BridgeError && (err.code === "CONNECT_FAILED" || err.code === "DISCONNECTED")) {
          throw new BridgeError(
            "GAME_NOT_RUNNING",
            "no runtime server on 127.0.0.1:9090 — start the game in the editor (F5) with a debug build",
          );
        }
        throw err;
      }
    },
    async close() {
      await editor.close();
      if (runtime) await runtime.close();
    },
  };
}
