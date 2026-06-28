/**
 * LSP session layer — the stateful connection core behind the LSP tools.
 *
 * Owns the lazy singleton LspClient, the verified-verdict status reporter
 * wired by lsp_status_reporter.ts, the connect prologue (ensureLsp) with its
 * code/hint mapping, and the file-read + document-open helpers the tool
 * handlers build on. tools/lsp.ts is the thin tool surface over this module.
 */
import { readFile } from "node:fs/promises";

import type { ToolTextResult } from "./types.js";
import { toolError } from "./error_contract.js";
import { LspClient, LspResolutionError, type LspStatus } from "./lsp_client.js";
import { resToAbsolute, absoluteToFileUri } from "./lsp_uri.js";

// ── Shared validation ──────────────────────────────────────────────

export function validateGdscriptPath(filePath: string): ToolTextResult | null {
  if (!filePath.startsWith("res://")) {
    return toolError("INVALID_PATH", "file_path must start with res://");
  }
  if (filePath.endsWith(".gd") || filePath.endsWith(".gdshader") || filePath.endsWith(".gdshaderinc")) {
    return null; // Supported.
  }
  // Unsupported file type — Godot's built-in LSP only serves GDScript and shaders.
  if (filePath.endsWith(".cs")) {
    return toolError(
      "UNSUPPORTED_FILE_TYPE",
      "Godot's built-in LSP only covers GDScript (.gd) and shaders (.gdshader). " +
        "C# (.cs) diagnostics come from the .NET language server in your IDE (VS Code, Rider).",
    );
  }
  return toolError(
    "UNSUPPORTED_FILE_TYPE",
    "Godot's built-in LSP only covers .gd and .gdshader/.gdshaderinc files. " +
      "Other languages (C++, Rust, Python via GDExtension) use external toolchains with no Godot LSP integration.",
  );
}

// ── Connection state ───────────────────────────────────────────────

/** Singleton LSP client (lazy, shared across all LSP tool calls). */
let _lspClient: LspClient | null = null;

function getLspClient(projectPath: string): LspClient {
  if (!_lspClient) _lspClient = new LspClient(projectPath);
  return _lspClient;
}

/** Set by index.ts to push the VERIFIED LSP verdict (the actual connection
 *  result) to the editor dock after each connection attempt — so the dock
 *  reflects reality on actual use: it flips to active once a closed editor frees
 *  the port and this LSP rebinds (4.5+), or to unavailable on 4.2-4.4 (no retry). */
let _statusReporter: ((s: LspStatus) => void) | null = null;
export function setLspStatusReporter(cb: (s: LspStatus) => void): void {
  _statusReporter = cb;
}

// ── Connection prologue ────────────────────────────────────────────

/**
 * Build the connect-failure hint for the LSP_UNAVAILABLE branch below. Causes
 * are ordered by likelihood given the editor is usually up — the calling agent
 * is already using other MCP tools that need it — so the "editor not running"
 * theory (the cause most callers can already rule out) comes LAST. The common
 * real cause is the GDScript LSP not listening on the port we tried: the editor
 * may have been launched with --lsp-port (which the registry can't see), so the
 * server connected to the default and got ECONNREFUSED. Pure + exported so the
 * ordering/contents are unit-testable without a live client.
 */
export function lspConnectFailureHint(port: number): string {
  return (
    `Could not reach the GDScript LSP on port ${port}. Most likely the LSP is listening on a ` +
    `different port — the editor may have been launched with --lsp-port, or its ` +
    `network/language_server/remote_port setting differs from ${port}; set GODOT_MCP_LSP_PORT to ` +
    `the actual LSP port to match. The LSP may also still be initializing — retry shortly. ` +
    `Only if no other MCP tool works at all is the editor not running.`
  );
}

export async function ensureLsp(projectPath: string): Promise<ToolTextResult | LspClient> {
  const client = getLspClient(projectPath);
  try {
    await client.ensureConnected();
    const ep = client.getEndpoint();
    _statusReporter?.({ state: "active", host: ep.host, port: ep.port, detail: "Connected and verified." });
    return client;
  } catch (err) {
    // Resolution errors carry a specific code + hint (LSP_PORT_CONFLICT /
    // LSP_UNAVAILABLE); a raw connect failure is a generic LSP_UNAVAILABLE.
    if (err instanceof LspResolutionError) {
      _statusReporter?.({
        state: err.code === "LSP_PORT_CONFLICT" ? "conflict" : "unavailable",
        host: "127.0.0.1",
        port: err.port,
        detail: err.message,
      });
      return toolError(err.code, err.message, err.hint);
    }
    // Connect failure (e.g. ECONNREFUSED) — report the endpoint we actually tried.
    const ep = client.getEndpoint();
    _statusReporter?.({ state: "unavailable", host: ep.host, port: ep.port, detail: (err as Error).message });
    return toolError(
      "LSP_UNAVAILABLE",
      `GDScript LSP unavailable: ${(err as Error).message}.`,
      lspConnectFailureHint(ep.port),
    );
  }
}

// ── Document I/O ───────────────────────────────────────────────────

async function readFileContent(filePath: string, projectPath: string): Promise<string | ToolTextResult> {
  const absPath = resToAbsolute(filePath, projectPath);
  try {
    return await readFile(absPath, "utf-8");
  } catch (err) {
    return toolError("READ_FAILED", `Cannot read ${filePath}: ${(err as Error).message}`);
  }
}

export async function openDocInLsp(
  client: LspClient,
  filePath: string,
  projectPath: string,
): Promise<{ uri: string } | ToolTextResult> {
  const content = await readFileContent(filePath, projectPath);
  if (typeof content !== "string") return content; // Error result.

  const absPath = resToAbsolute(filePath, projectPath);
  const uri = absoluteToFileUri(absPath);
  await client.openDocument(uri, content);
  return { uri };
}
