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

export function createBridge(url: string): Bridge {
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
      if (closed) throw new BridgeError("CLOSED", "bridge is closed");
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
      rejectAll("CLOSED", "bridge closed by caller");
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
