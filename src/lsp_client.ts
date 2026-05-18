/**
 * Lightweight LSP client for Godot's built-in GDScript language server.
 * Connects via TCP to localhost:6005 (configurable via GODOT_MCP_LSP_PORT).
 * Lazy connection — first request triggers connect + initialize handshake.
 * Graceful degradation — returns LSP_UNAVAILABLE on connection failure.
 */
import { createConnection, type Socket } from "node:net";

// ── Constants ────────────────────────────────────────────────────────

const DEFAULT_LSP_PORT = 6005;
const CONNECT_TIMEOUT_MS = 5_000;
const REQUEST_TIMEOUT_MS = 10_000;
const HEADER_SEPARATOR = "\r\n\r\n";

/**
 * Normalize a file URI for map lookups. Godot's LSP may return URIs
 * with different drive-letter casing or percent-encoding than we send.
 */
function normalizeUri(uri: string): string {
  let norm = decodeURIComponent(uri).replace(/\\/g, "/");
  // Lowercase Windows drive letter: file:///C: → file:///c:
  if (/^file:\/\/\/[A-Z]:/.test(norm)) {
    norm = "file:///" + norm[8].toLowerCase() + norm.slice(9);
  }
  return norm;
}

// ── Types ────────────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

type Pending = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
};

export type DiagnosticEntry = {
  line: number;
  character: number;
  severity: number;
  message: string;
  code?: string | number;
};

// ── LspClient ────────────────────────────────────────────────────────

export class LspClient {
  private socket: Socket | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private buffer = "";
  private initialized = false;
  private connecting: Promise<void> | null = null;
  private port: number;

  // Document tracking — which files have been opened via didOpen.
  private openDocuments = new Set<string>();

  // Notification storage — keyed by URI, stores latest diagnostics.
  private diagnosticsByUri = new Map<string, DiagnosticEntry[]>();
  private diagnosticWaiters = new Map<string, { resolve: () => void; timer: NodeJS.Timeout }>();

  constructor() {
    const envPort = process.env.GODOT_MCP_LSP_PORT;
    this.port = envPort ? parseInt(envPort, 10) || DEFAULT_LSP_PORT : DEFAULT_LSP_PORT;
  }

  /** Ensure connection is established. Lazy — connects on first call. */
  async ensureConnected(): Promise<void> {
    if (this.initialized && this.socket && !this.socket.destroyed) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.doConnect();
    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  private async doConnect(): Promise<void> {
    // Reset state from any previous connection.
    this.cleanup();

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`LSP connect timeout (port ${this.port})`));
      }, CONNECT_TIMEOUT_MS);

      const socket = createConnection({ host: "127.0.0.1", port: this.port }, () => {
        clearTimeout(timer);
        this.socket = socket;
        resolve();
      });

      socket.on("error", (err) => {
        clearTimeout(timer);
        reject(new Error(`LSP connect failed (port ${this.port}): ${err.message}`));
      });

      socket.on("data", (chunk) => this.onData(chunk.toString("utf-8")));
      socket.on("close", () => this.onClose());
    });

    // LSP initialize handshake.
    const initResult = await this.sendRequest("initialize", {
      processId: process.pid,
      capabilities: {},
      rootUri: null,
      clientInfo: { name: "godot-mcp-server", version: "0.1.0" },
    });

    if (!initResult || typeof initResult !== "object") {
      throw new Error("LSP initialize failed: no capabilities returned");
    }

    // Send initialized notification.
    this.sendNotification("initialized", {});
    this.initialized = true;
  }

  /** Send a JSON-RPC request and await the response. */
  async sendRequest(method: string, params?: unknown): Promise<unknown> {
    if (!this.socket || this.socket.destroyed) {
      throw new Error("LSP not connected");
    }

    const id = this.nextId++;
    const request: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
    const body = JSON.stringify(request);

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`LSP request timeout: ${method}`));
      }, REQUEST_TIMEOUT_MS);

      this.pending.set(id, { resolve, reject, timer });
      this.writeMessage(body);
    });
  }

  /** Send a JSON-RPC notification (no response expected). */
  sendNotification(method: string, params?: unknown): void {
    if (!this.socket || this.socket.destroyed) return;
    const notification: JsonRpcNotification = { jsonrpc: "2.0", method, params };
    this.writeMessage(JSON.stringify(notification));
  }

  /** Open a document in the LSP (or update if already open). */
  async openDocument(uri: string, content: string): Promise<void> {
    if (this.openDocuments.has(uri)) {
      // Already open — send didChange with full content.
      this.sendNotification("textDocument/didChange", {
        textDocument: { uri, version: this.nextId++ },
        contentChanges: [{ text: content }],
      });
    } else {
      this.sendNotification("textDocument/didOpen", {
        textDocument: { uri, languageId: "gdscript", version: 1, text: content },
      });
      this.openDocuments.add(uri);
    }
  }

  /** Wait for diagnostics to arrive for a URI (with timeout). */
  async waitForDiagnostics(uri: string, timeoutMs = 5000): Promise<DiagnosticEntry[]> {
    const normUri = normalizeUri(uri);

    // Check if we already have diagnostics from the notification.
    const existing = this.diagnosticsByUri.get(normUri);
    if (existing !== undefined) {
      this.diagnosticsByUri.delete(normUri);
      return existing;
    }

    // Wait for the notification to arrive.
    return new Promise<DiagnosticEntry[]>((resolve) => {
      const timer = setTimeout(() => {
        this.diagnosticWaiters.delete(normUri);
        // Final check — notification may have stored diagnostics under
        // a slightly different key before normalization took effect.
        const late = this.diagnosticsByUri.get(normUri) ?? [];
        this.diagnosticsByUri.delete(normUri);
        resolve(late);
      }, timeoutMs);

      this.diagnosticWaiters.set(normUri, {
        resolve: () => {
          clearTimeout(timer);
          const diags = this.diagnosticsByUri.get(normUri) ?? [];
          this.diagnosticsByUri.delete(normUri);
          resolve(diags);
        },
        timer,
      });
    });
  }

  /** Check if the client is currently connected. */
  isConnected(): boolean {
    return this.initialized && !!this.socket && !this.socket.destroyed;
  }

  /** Graceful shutdown. */
  async close(): Promise<void> {
    if (!this.socket || this.socket.destroyed) return;
    try {
      await this.sendRequest("shutdown", null);
      this.sendNotification("exit");
    } catch {
      // Best-effort shutdown.
    }
    this.cleanup();
  }

  // ── Private ────────────────────────────────────────────────────────

  private writeMessage(body: string): void {
    const header = `Content-Length: ${Buffer.byteLength(body, "utf-8")}${HEADER_SEPARATOR}`;
    this.socket!.write(header + body, "utf-8");
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    this.processBuffer();
  }

  private processBuffer(): void {
    while (true) {
      const headerEnd = this.buffer.indexOf(HEADER_SEPARATOR);
      if (headerEnd === -1) break;

      // Parse Content-Length from headers.
      const headerBlock = this.buffer.slice(0, headerEnd);
      const match = headerBlock.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        // Malformed — skip this header block.
        this.buffer = this.buffer.slice(headerEnd + HEADER_SEPARATOR.length);
        continue;
      }

      const contentLength = parseInt(match[1], 10);
      const bodyStart = headerEnd + HEADER_SEPARATOR.length;

      // Check if we have the full body.
      if (Buffer.byteLength(this.buffer.slice(bodyStart), "utf-8") < contentLength) break;

      // Extract body by byte length.
      const bodyBytes = Buffer.from(this.buffer.slice(bodyStart), "utf-8");
      const body = bodyBytes.slice(0, contentLength).toString("utf-8");
      const remainderBytes = bodyBytes.slice(contentLength);
      this.buffer = remainderBytes.toString("utf-8");

      this.handleMessage(body);
    }
  }

  private handleMessage(body: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(body);
    } catch {
      return;
    }

    // Response to a request we sent.
    if ("id" in msg && msg.id != null) {
      const resp = msg as unknown as JsonRpcResponse;
      const pending = this.pending.get(resp.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(resp.id);
        if (resp.error) {
          pending.reject(new Error(`LSP error [${resp.error.code}]: ${resp.error.message}`));
        } else {
          pending.resolve(resp.result);
        }
      }
      return;
    }

    // Server notification (no id).
    if ("method" in msg) {
      this.handleNotification(msg as unknown as { method: string; params?: unknown });
    }
  }

  private handleNotification(notification: { method: string; params?: unknown }): void {
    if (notification.method === "textDocument/publishDiagnostics") {
      const params = notification.params as { uri?: string; diagnostics?: unknown[] } | undefined;
      if (!params?.uri) return;

      const uri = normalizeUri(params.uri);
      const diagnostics: DiagnosticEntry[] = (params.diagnostics ?? []).map((d: unknown) => {
        const diag = d as {
          range?: { start?: { line?: number; character?: number } };
          severity?: number;
          message?: string;
          code?: string | number;
        };
        return {
          line: diag.range?.start?.line ?? 0,
          character: diag.range?.start?.character ?? 0,
          severity: diag.severity ?? 1,
          message: diag.message ?? "",
          code: diag.code,
        };
      });

      this.diagnosticsByUri.set(uri, diagnostics);

      // Wake any waiter for this URI.
      const waiter = this.diagnosticWaiters.get(uri);
      if (waiter) {
        this.diagnosticWaiters.delete(uri);
        waiter.resolve();
      }
    }
  }

  private onClose(): void {
    this.initialized = false;
    this.openDocuments.clear();
    // Reject all pending requests.
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error("LSP connection closed"));
    }
    this.pending.clear();
  }

  private cleanup(): void {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.initialized = false;
    this.openDocuments.clear();
    this.diagnosticsByUri.clear();
    for (const [, waiter] of this.diagnosticWaiters) {
      clearTimeout(waiter.timer);
    }
    this.diagnosticWaiters.clear();
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
    }
    this.pending.clear();
  }
}
