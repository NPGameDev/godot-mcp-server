import { WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { Bridge, BridgeError } from "./types.js";

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

// -- Token resolution --------------------------------------------------------

/**
 * Resolve the Godot project name from project.godot in the working directory.
 * Falls back to "unnamed" if the file is missing or can't be parsed.
 */
async function resolveProjectName(): Promise<string> {
  try {
    const content = await readFile("project.godot", "utf-8");
    const match = content.match(/config\/name="([^"]+)"/);
    if (match) return match[1];
  } catch {
    // project.godot not in cwd — try the common case where the server is
    // launched from the project root.
  }
  return "unnamed";
}

/**
 * Cross-platform Godot user:// path resolution.
 *   win32:  %APPDATA%/Godot/app_userdata/<project>/mcp_token
 *   darwin: ~/Library/Application Support/Godot/app_userdata/<project>/mcp_token
 *   linux:  ~/.local/share/godot/app_userdata/<project>/mcp_token
 */
async function resolveTokenPath(): Promise<string> {
  const envPath = process.env.GODOT_MCP_TOKEN_PATH;
  if (envPath) return envPath;

  const projectName = await resolveProjectName();
  switch (process.platform) {
    case "win32":
      return join(
        process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"),
        "Godot", "app_userdata", projectName, "mcp_token",
      );
    case "darwin":
      return join(
        homedir(), "Library", "Application Support",
        "Godot", "app_userdata", projectName, "mcp_token",
      );
    default:
      return join(
        homedir(), ".local", "share",
        "godot", "app_userdata", projectName, "mcp_token",
      );
  }
}

/**
 * Read the session token from disk. Re-reads on every call (no caching) so
 * reconnects after a plugin restart pick up the rotated token.
 */
async function readToken(): Promise<string> {
  const tokenPath = await resolveTokenPath();
  try {
    const token = (await readFile(tokenPath, "utf-8")).trim();
    return token;
  } catch (err) {
    throw new BridgeError(
      "AUTH_FAILED",
      `cannot read token file at ${tokenPath}: ${(err as Error).message}`,
    );
  }
}

/**
 * Send the auth handshake and wait for {"authed": true} or a close frame.
 * Resolves on success, rejects on failure or timeout (2s).
 */
function authenticate(ws: WebSocket, token: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new BridgeError("AUTH_FAILED", "auth handshake timed out"));
    }, 5000);

    function cleanup(): void {
      clearTimeout(timer);
      ws.removeListener("message", onMessage);
      ws.removeListener("close", onClose);
    }

    function onMessage(data: unknown): void {
      try {
        const msg = JSON.parse(String(data)) as { authed?: boolean };
        if (msg.authed === true) {
          cleanup();
          resolve();
        }
      } catch {
        // Not JSON — ignore, keep waiting.
      }
    }

    function onClose(_code: number, reason: Buffer): void {
      cleanup();
      reject(new BridgeError(
        "AUTH_FAILED",
        `server closed connection during auth: ${reason.toString()}`,
      ));
    }

    ws.on("message", onMessage);
    ws.on("close", onClose);
    ws.send(JSON.stringify({ auth: token }));
  });
}

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
        // Note: attempt is reset on successful message round-trip (below),
        // not on open — open alone isn't proof the peer is healthy. A
        // half-broken peer that accepts then immediately closes the socket
        // would otherwise reset backoff every cycle.
        process.stderr.write(`[bridge] ${url} ${wasReconnect ? "reconnected" : "connected"}, authenticating…\n`);
        // Re-read token from disk on every connect (including reconnects)
        // so rotated tokens after a plugin restart are picked up.
        readToken()
          .then((token) => authenticate(socket, token))
          .then(() => {
            hasConnectedOnce = true;
            process.stderr.write(`[bridge] ${url} authenticated\n`);
            resolveAllWaiters(socket);
            resolve(socket);
          })
          .catch((err) => {
            ws = null;
            socket.close();
            const error = err instanceof BridgeError
              ? err
              : new BridgeError("AUTH_FAILED", (err as Error).message);
            rejectAllWaiters(error.code, error.message);
            reject(error);
            if (!closed) scheduleReconnect();
          });
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
        let message: JsonRpcResponse;
        try {
          message = JSON.parse(data.toString()) as JsonRpcResponse;
        } catch {
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

export function createBridge(editorUrl: string, runtimeUrl?: string): Bridge {
  const editor = createChannel(editorUrl);
  // Runtime channel is created lazily so calls that never touch Mode B
  // don't pay a failed-connect cost at startup. callRuntime translates
  // the channel's CONNECT_FAILED / DISCONNECTED into GAME_NOT_RUNNING
  // so the MCP tool layer can surface a clean, actionable error.
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
