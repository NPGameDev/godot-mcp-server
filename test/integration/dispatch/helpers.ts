// ═══════════════════════════════════════════════════════════════════════════
// Integration test helpers — raw WebSocket utilities for dispatch tests.
//
// Tests connect directly to the toolkit's WebSocket server (bypassing the
// MCP bridge) so they can observe _queued / _executing notifications that
// the bridge swallows internally.
// ═══════════════════════════════════════════════════════════════════════════

import WebSocket from "ws";

// ─── Types ──────────────────────────────────────────────────────────────

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
};

export type JsonRpcNotification = {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
};

export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
};

export type JsonRpcMessage = JsonRpcResponse | JsonRpcNotification;

export type FlowCtx = {
  pass: (msg: string) => void;
  fail: (msg: string) => void;
};

// ─── Constants ──────────────────────────────────────────────────────────

const DEFAULT_WAIT_TIMEOUT_MS = 30_000;
const FLOW_TIMEOUT_MS = 120_000;

// ─── Connection ─────────────────────────────────────────────────────────

/**
 * Open a raw WebSocket to the toolkit and authenticate with the token.
 * Returns the connected + authenticated WebSocket and a MessageCollector
 * that captures every incoming message for later inspection.
 *
 * Auth is handled via a direct listener before the collector is created,
 * so the auth response doesn't pollute the message log.
 */
export async function connectAndAuth(
  port: number,
  token: string,
): Promise<{ ws: WebSocket; collector: MessageCollector }> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);

  // Wait for connection.
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("WebSocket connect timeout")), DEFAULT_WAIT_TIMEOUT_MS);
    ws.once("open", () => {
      clearTimeout(timeout);
      resolve();
    });
    ws.once("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  // Send auth handshake and wait for response via direct listener.
  ws.send(JSON.stringify({ auth: token }));

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Auth response timeout")), DEFAULT_WAIT_TIMEOUT_MS);
    const handler = (data: WebSocket.Data) => {
      try {
        const msg = JSON.parse(data.toString()) as { authed?: boolean };
        if (msg.authed === true) {
          clearTimeout(timeout);
          ws.removeListener("message", handler);
          resolve();
        } else if (msg.authed === false) {
          clearTimeout(timeout);
          ws.removeListener("message", handler);
          reject(new Error("Authentication failed — check GODOT_MCP_TOKEN"));
        }
      } catch {
        // Ignore parse errors during auth.
      }
    };
    ws.on("message", handler);
  });

  // Auth done — now create the collector for subsequent messages.
  const collector = new MessageCollector(ws);
  return { ws, collector };
}

// ─── Sending ────────────────────────────────────────────────────────────

let _nextId = 1;

/** Reset the global ID counter (call at start of each flow). */
export function resetIdCounter(): void {
  _nextId = 1;
}

/** Send a JSON-RPC request and return the assigned ID. */
export function sendRequest(ws: WebSocket, method: string, params?: Record<string, unknown>): number {
  const id = _nextId++;
  const msg: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
  ws.send(JSON.stringify(msg));
  return id;
}

/** Send a JSON-RPC notification (no id — fire-and-forget). */
export function sendNotification(ws: WebSocket, method: string, params?: Record<string, unknown>): void {
  const msg: JsonRpcNotification = { jsonrpc: "2.0", method, params };
  ws.send(JSON.stringify(msg));
}

// ─── MessageCollector ───────────────────────────────────────────────────

/**
 * Captures every incoming WebSocket message (after auth) for later
 * inspection. Provides waitFor() with notification-gated synchronization.
 */
export class MessageCollector {
  readonly messages: JsonRpcMessage[] = [];
  private _waiters: Array<{
    filter: (msg: JsonRpcMessage) => boolean;
    resolve: (msg: JsonRpcMessage) => void;
    reject: (err: Error) => void;
  }> = [];

  constructor(ws: WebSocket) {
    ws.on("message", (data) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        return; // Ignore malformed messages.
      }

      const msg = parsed as JsonRpcMessage;
      this.messages.push(msg);

      // Check waiting consumers.
      for (let i = this._waiters.length - 1; i >= 0; i--) {
        if (this._waiters[i].filter(msg)) {
          const waiter = this._waiters.splice(i, 1)[0];
          waiter.resolve(msg);
        }
      }
    });
  }

  /**
   * Wait for a message matching `filter`. Checks already-collected
   * messages first, then waits for new ones.
   */
  waitFor(filter: (msg: JsonRpcMessage) => boolean, timeoutMs = DEFAULT_WAIT_TIMEOUT_MS): Promise<JsonRpcMessage> {
    // Check existing messages first.
    const existing = this.messages.find(filter);
    if (existing) return Promise.resolve(existing);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this._waiters.findIndex((w) => w.resolve === resolve);
        if (idx >= 0) this._waiters.splice(idx, 1);
        reject(new Error(`waitFor timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this._waiters.push({
        filter,
        resolve: (msg) => {
          clearTimeout(timer);
          resolve(msg);
        },
        reject,
      });
    });
  }

  /** Wait for a JSON-RPC response with a specific id. */
  waitForResponse(id: number, timeoutMs = DEFAULT_WAIT_TIMEOUT_MS): Promise<JsonRpcResponse> {
    return this.waitFor(
      (msg) => "id" in msg && (msg as JsonRpcResponse).id === id,
      timeoutMs,
    ) as Promise<JsonRpcResponse>;
  }

  /** Wait for a notification with a specific method and optional request_id. */
  waitForNotification(
    method: string,
    requestId?: number,
    timeoutMs = DEFAULT_WAIT_TIMEOUT_MS,
  ): Promise<JsonRpcNotification> {
    return this.waitFor(
      (msg) =>
        "method" in msg &&
        (msg as JsonRpcNotification).method === method &&
        (requestId === undefined || (msg as JsonRpcNotification).params?.request_id === requestId),
      timeoutMs,
    ) as Promise<JsonRpcNotification>;
  }

  /** Check that NO message matches the filter among already-collected messages. */
  hasNoMessage(filter: (msg: JsonRpcMessage) => boolean): boolean {
    return !this.messages.some(filter);
  }

  /** Clear collected messages (for flow isolation). */
  clear(): void {
    this.messages.length = 0;
  }
}

// ─── Flow runner ────────────────────────────────────────────────────────

export type FlowFn = (port: number, token: string, ctx: FlowCtx) => Promise<void>;

/** Run a flow with a per-flow timeout (120s safety net). */
export async function runWithTimeout(fn: FlowFn, port: number, token: string, ctx: FlowCtx): Promise<void> {
  await Promise.race([
    fn(port, token, ctx),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Flow exceeded ${FLOW_TIMEOUT_MS}ms hard cap`)), FLOW_TIMEOUT_MS),
    ),
  ]);
}

// ─── Cleanup helpers ────────────────────────────────────────────────────

/** Close a WebSocket connection cleanly. */
export function closeWs(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
      resolve();
      return;
    }
    ws.once("close", () => resolve());
    ws.close();
  });
}
