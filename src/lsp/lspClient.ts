/**
 * Lightweight LSP client for Godot's built-in GDScript language server.
 * The endpoint is discovered PER PROJECT from the registry at connect time
 * (GODOT_MCP_LSP_PORT/_HOST override it); a collision fails visibly rather than
 * silently reaching the wrong editor. See ADR 0008 (toolkit). Lazy connection —
 * first request triggers connect + initialize handshake.
 */
import { createConnection, type Socket } from "node:net";

import { discoverLspEndpoint, liveLspClaimants } from "../registry.js";
import { isVersionAtLeast, type GodotVer } from "../shared/version.js";
import { normalizeUri } from "./lspUri.js";

// ── Constants ────────────────────────────────────────────────────────

const DEFAULT_LSP_PORT = 6005;
const CONNECT_TIMEOUT_MS = 5_000;
const REQUEST_TIMEOUT_MS = 10_000;
const HEADER_SEPARATOR = "\r\n\r\n";

// Substring of the GDScript LSP's workspace-root-mismatch warning (window/
// showMessage), shipped in Godot 4.5+ (PR #104401). Engine-verified against
// gdscript_language_protocol.cpp on 4.5/4.6; absent 4.2-4.4. We send our real
// rootUri in initialize, so this fires only when we reached the WRONG editor.
const ROOT_MISMATCH_SUBSTRING = "might not work correctly with other projects";

// Conflict hint, tailored to the connected Godot version (set by index.ts via
// setGodotVersionGetter). The recovery differs by version: 4.5+ auto-rebinds the
// port when the other editor closes; 4.2-4.4 has no LSP bind retry, so it needs
// distinct ports. Giving the LLM only the applicable path keeps the hint actionable.
let _godotVersionGetter: (() => GodotVer | undefined) | undefined = undefined;
export function setGodotVersionGetter(cb: () => GodotVer | undefined): void {
  _godotVersionGetter = cb;
}

function lspConflictHint(): string {
  const v = _godotVersionGetter?.();
  if (v != null && isVersionAtLeast(v, "4.5")) {
    return (
      "Another editor holds this project's GDScript LSP port. Close the other editor — " +
      "this editor's LSP then rebinds the port automatically — or give each editor a " +
      "distinct --lsp-port + GODOT_MCP_LSP_PORT (docs/multi-instance.md)."
    );
  }
  if (v != null) {
    // 4.2-4.4: no LSP bind retry, so closing the other editor won't recover this one.
    return (
      "Another editor holds this project's GDScript LSP port. On this Godot version, give " +
      "each editor a distinct --lsp-port + GODOT_MCP_LSP_PORT (docs/multi-instance.md) — " +
      "closing the other editor won't recover this LSP without restarting this editor."
    );
  }
  // Version unknown — cover both ranges.
  return (
    "Another editor holds this project's GDScript LSP port. Either give each editor a " +
    "distinct --lsp-port + GODOT_MCP_LSP_PORT (docs/multi-instance.md), or close the other " +
    "editor (Godot 4.5+ rebinds automatically; 4.2-4.4 restart this editor after)."
  );
}

const LSP_UNAVAILABLE_HINT =
  "GDScript LSP not reachable. Ensure the Godot editor is running with the toolkit " +
  "plugin enabled. With multiple editors open, give each a distinct --lsp-port + " +
  "GODOT_MCP_LSP_PORT (docs/multi-instance.md).";

/** Resolution failure carrying a specific tool error code + actionable hint. */
export class LspResolutionError extends Error {
  constructor(
    public readonly code: "LSP_PORT_CONFLICT" | "LSP_UNAVAILABLE",
    message: string,
    public readonly hint: string,
    public readonly port: number,
  ) {
    super(message);
    this.name = "LspResolutionError";
  }
}

export type LspEndpoint = { host: string; port: number };

/**
 * Resolve a project's LSP endpoint at connect time. Priority:
 *   1. GODOT_MCP_LSP_PORT (+ GODOT_MCP_LSP_HOST) — explicit override, top
 *      priority, bypasses the registry (the documented multi-instance lever).
 *   2. discoverLspEndpoint(projectPath) — registry hit (with conflict guard).
 *   3. miss → 6005 ONLY if no live editor holds it; else unavailable.
 * Throws LspResolutionError on a conflict or an ambiguous miss — never a blind
 * 6005 fallback (that is what kept comparable tools returning the wrong project).
 */
export function resolveLspEndpoint(projectPath: string): LspEndpoint {
  const envPort = process.env.GODOT_MCP_LSP_PORT;
  if (envPort) {
    const port = parseInt(envPort, 10);
    if (Number.isInteger(port) && port > 0) {
      return { host: process.env.GODOT_MCP_LSP_HOST || "127.0.0.1", port };
    }
  }
  const disc = discoverLspEndpoint(projectPath);
  if (disc) {
    if ("conflict" in disc) {
      throw new LspResolutionError(
        "LSP_PORT_CONFLICT",
        `Another live editor owns GDScript LSP port ${disc.port}; refusing to return its results.`,
        lspConflictHint(),
        disc.port,
      );
    }
    return disc;
  }
  // Registry miss — fall back to 6005 only when no live editor holds it.
  if (liveLspClaimants(DEFAULT_LSP_PORT).length === 0) {
    return { host: "127.0.0.1", port: DEFAULT_LSP_PORT };
  }
  throw new LspResolutionError(
    "LSP_UNAVAILABLE",
    `No registry LSP endpoint for this project and port ${DEFAULT_LSP_PORT} is held by another editor.`,
    LSP_UNAVAILABLE_HINT,
    DEFAULT_LSP_PORT,
  );
}

export type LspStatus = {
  state: "active" | "conflict" | "unavailable";
  host: string;
  port: number;
  detail: string;
};

/**
 * The authoritative LSP verdict for a project, computed without opening a
 * connection (resolution + registry ownership only — reliable cross-platform
 * liveness via process.kill). The toolkit can't determine this itself (no engine
 * API for its own LSP bind status), so the server reports it to the editor dock
 * via editor.set_lsp_status. "active" = this editor owns the port (per registry /
 * env override); a later editor or a non-registry holder → conflict / unavailable.
 */
export function getLspStatus(projectPath: string): LspStatus {
  try {
    const ep = resolveLspEndpoint(projectPath);
    return { state: "active", host: ep.host, port: ep.port, detail: "Owns the GDScript LSP port." };
  } catch (err) {
    if (err instanceof LspResolutionError) {
      return {
        state: err.code === "LSP_PORT_CONFLICT" ? "conflict" : "unavailable",
        host: "127.0.0.1",
        port: err.port,
        detail: err.message,
      };
    }
    return { state: "unavailable", host: "127.0.0.1", port: DEFAULT_LSP_PORT, detail: String(err) };
  }
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
  private socket: Socket | undefined = undefined;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private buffer = "";
  private initialized = false;
  private connecting: Promise<void> | undefined = undefined;
  private host = "127.0.0.1";
  private port = DEFAULT_LSP_PORT;
  private readonly projectPath: string;
  // Set when the LSP emits the 4.5+ root-mismatch warning during initialize —
  // means we reached an editor open on a different project. Reset each connect.
  private rootMismatch = false;

  // Document tracking — which files have been opened via didOpen.
  private openDocuments = new Set<string>();

  // Notification storage — keyed by URI, stores latest diagnostics.
  private diagnosticsByUri = new Map<string, DiagnosticEntry[]>();
  private diagnosticWaiters = new Map<string, { resolve: () => void; timer: NodeJS.Timeout }>();

  constructor(projectPath: string) {
    this.projectPath = projectPath;
  }

  /** file:// URI for the project root — sent as rootUri so the 4.5+ LSP can
   *  warn (window/showMessage) when we reached an editor open on a different
   *  project, i.e. a port collision reached the wrong editor. */
  private projectRootUri(): string {
    const norm = this.projectPath.replace(/\\/g, "/").replace(/\/+$/, "");
    return /^[A-Za-z]:/.test(norm) ? `file:///${norm}` : `file://${norm}`;
  }

  /** Ensure connection is established. Lazy — connects on first call. */
  async ensureConnected(): Promise<void> {
    if (this.initialized && this.socket && !this.socket.destroyed) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.doConnect();
    try {
      await this.connecting;
    } finally {
      this.connecting = undefined;
    }
  }

  private async doConnect(): Promise<void> {
    // Reset state from any previous connection.
    this.cleanup();
    this.rootMismatch = false;

    // Resolve fresh each connect so a reconnect picks up a changed port/host.
    // Throws LspResolutionError on a conflict / ambiguous miss (no blind 6005).
    const endpoint = resolveLspEndpoint(this.projectPath);
    this.host = endpoint.host;
    this.port = endpoint.port;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`LSP connect timeout (${this.host}:${this.port})`));
      }, CONNECT_TIMEOUT_MS);

      const socket = createConnection({ host: this.host, port: this.port }, () => {
        clearTimeout(timer);
        this.socket = socket;
        resolve();
      });

      socket.on("error", (err) => {
        clearTimeout(timer);
        reject(new Error(`LSP connect failed (${this.host}:${this.port}): ${err.message}`));
      });

      socket.on("data", (chunk) => this.onData(chunk.toString("utf-8")));
      socket.on("close", () => this.onClose());
    });

    // LSP initialize handshake. Send our REAL rootUri (not null): on Godot 4.5+
    // the server emits a window/showMessage root-mismatch warning when the URI
    // resolves to a different open project — i.e. we reached the wrong editor.
    // The engine sends that warning BEFORE the initialize response
    // (gdscript_language_protocol.cpp), so rootMismatch is already set when this
    // await resolves.
    const initResult = await this.sendRequest("initialize", {
      processId: process.pid,
      capabilities: {},
      rootUri: this.projectRootUri(),
      clientInfo: { name: "godot-mcp-server", version: "0.1.0" },
    });

    if (!initResult || typeof initResult !== "object") {
      throw new Error("LSP initialize failed: no capabilities returned");
    }

    if (this.rootMismatch) {
      this.cleanup();
      throw new LspResolutionError(
        "LSP_PORT_CONFLICT",
        `Reached an editor open on a different project on LSP port ${this.port} (root mismatch).`,
        lspConflictHint(),
        this.port,
      );
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

  /** The host:port resolved for the most recent connect attempt (valid after
   *  doConnect set it — i.e. when a connect was attempted, success or failure). */
  getEndpoint(): { host: string; port: number } {
    return { host: this.host, port: this.port };
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
    if (notification.method === "window/showMessage") {
      // Godot 4.5+ root-mismatch warning → we reached an editor open on a
      // different project (port collision). doConnect checks this after init.
      const params = notification.params as { message?: string } | undefined;
      if (params?.message && params.message.includes(ROOT_MISMATCH_SUBSTRING)) {
        this.rootMismatch = true;
      }
      return;
    }
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
      this.socket = undefined;
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
