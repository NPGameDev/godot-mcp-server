import { WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { Bridge, BridgeError } from "./types.js";

const JSONRPC_VERSION = "2.0";
const DEFAULT_TIMEOUT_MS = 30_000;

type Pending = {
  resolve: (value: unknown) => void;
  reject: (reason: BridgeError) => void;
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
  let ws: WebSocket | null = null;
  let connectPromise: Promise<WebSocket> | null = null;
  let closed = false;

  function rejectAll(code: string, message: string): void {
    for (const [id, p] of pending) {
      clearTimeout(p.timer);
      p.reject(new BridgeError(code, message));
      pending.delete(id);
    }
  }

  function connect(): Promise<WebSocket> {
    if (ws && ws.readyState === WebSocket.OPEN) return Promise.resolve(ws);
    if (connectPromise) return connectPromise;
    connectPromise = new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      ws = socket;
      socket.once("open", () => {
        connectPromise = null;
        resolve(socket);
      });
      socket.once("error", (err) => {
        connectPromise = null;
        ws = null;
        reject(new BridgeError("CONNECT_FAILED", `WebSocket error: ${(err as Error).message}`));
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
        if (msg.error) {
          p.reject(new BridgeError("RPC_ERROR", `${msg.error.code}: ${msg.error.message}`));
        } else {
          p.resolve(msg.result);
        }
      });
      socket.on("close", () => {
        ws = null;
        rejectAll("DISCONNECTED", "WebSocket closed before response");
      });
    });
    return connectPromise;
  }

  return {
    async call(method: string, params: unknown = null, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<unknown> {
      if (closed) throw new BridgeError("CLOSED", "channel is closed");
      const socket = await connect();
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
    async close(): Promise<void> {
      closed = true;
      rejectAll("CLOSED", "channel closed by caller");
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
  // translates the channel's CONNECT_FAILED into GAME_NOT_RUNNING so the
  // MCP tool layer can surface a clean, actionable error.
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
