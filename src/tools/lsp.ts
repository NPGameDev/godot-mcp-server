/**
 * LSP tool definitions — GDScript language intelligence via Godot's
 * built-in language server. All tools are read-only and group-only
 * (lazy-loaded via discover_tools → lsp_tools group).
 */
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { ToolDef, ToolTextResult } from "../types.js";
import { toolError } from "../tool_helpers.js";
import { LspClient, LspResolutionError, type LspStatus } from "../lsp_client.js";
import { untrustedWrap } from "../untrusted.js";

// ── URI / path helpers ───────��───────────────────────────────────────

function resToAbsolute(resPath: string, projectPath: string): string {
  // res://foo/bar.gd → <projectPath>/foo/bar.gd
  const relative = resPath.replace(/^res:\/\//, "");
  return join(projectPath, relative);
}

function absoluteToFileUri(absPath: string): string {
  // Windows: C:\foo\bar.gd → file:///C:/foo/bar.gd
  // Unix: /foo/bar.gd → file:///foo/bar.gd
  const normalized = absPath.replace(/\\/g, "/");
  if (/^[A-Za-z]:/.test(normalized)) {
    return `file:///${normalized}`;
  }
  return `file://${normalized}`;
}

function fileUriToRes(uri: string, projectPath: string): string {
  // file:///C:/project/foo.gd → res://foo.gd
  let absPath: string;
  if (uri.startsWith("file:///")) {
    absPath = uri.slice(8); // Remove file:///
  } else if (uri.startsWith("file://")) {
    absPath = uri.slice(7); // Remove file://
  } else {
    return uri; // Not a file URI, return as-is.
  }

  // Decode percent-encoding.
  absPath = decodeURIComponent(absPath);

  // Normalize slashes.
  const normalizedProject = projectPath.replace(/\\/g, "/").replace(/\/$/, "");
  const normalizedPath = absPath.replace(/\\/g, "/");

  // Strip project prefix to get res:// path.
  if (normalizedPath.toLowerCase().startsWith(normalizedProject.toLowerCase())) {
    const relative = normalizedPath.slice(normalizedProject.length);
    return "res:/" + relative; // normalizedPath starts with / after project path
  }

  return uri; // Outside project — return raw.
}

/** Severity number → human-readable label. */
function severityLabel(severity: number): string {
  switch (severity) {
    case 1:
      return "Error";
    case 2:
      return "Warning";
    case 3:
      return "Information";
    case 4:
      return "Hint";
    default:
      return "Unknown";
  }
}

// ── Shared validation ───────���────────────────────────────────────────

function validateGdscriptPath(filePath: string): ToolTextResult | null {
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

// ── Tool definitions ─────────────���───────────────────────────────────

// ── Primary group: gdscript_analysis ─────────────────────────────────
// The 3 tools used most frequently during a write→validate→explore cycle.

export const lspAnalysisTools: ToolDef[] = [
  {
    name: "lsp_diagnostics",
    method: "lsp.diagnostics",
    description:
      "Rich GDScript/shader diagnostics with column positions and severity (Error/Warning/Info/Hint). Needs editor running. " +
      "Call editor_refresh first if files were just created.",
    inputSchema: {
      file_path: z
        .string()
        .describe(
          "Godot resource path (must start with res://, e.g. res://scripts/player.gd). Only .gd and .gdshader — not .cs",
        ),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    successHint: "For quick validation use script_check. For runtime errors use editor_get_console.",
  },
  {
    name: "lsp_symbols",
    method: "lsp.symbols",
    description:
      "List all symbols (functions, variables, classes, signals) in a .gd/.gdshader file. Structured tree — cheaper than reading full source.",
    inputSchema: {
      file_path: z
        .string()
        .describe(
          "Godot resource path (must start with res://, e.g. res://scripts/player.gd). Only .gd and .gdshader — not .cs",
        ),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "lsp_hover",
    method: "lsp.hover",
    description:
      "Get type signature and docs for one symbol at a specific position. Use for targeted type checks, not bulk exploration.",
    inputSchema: {
      file_path: z
        .string()
        .describe(
          "Godot resource path (must start with res://, e.g. res://scripts/player.gd). Only .gd and .gdshader — not .cs",
        ),
      line: z.coerce.number().int().min(0).describe("Zero-based line number"),
      column: z.coerce.number().int().min(0).describe("Zero-based column number"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];

// ── Secondary group: code_navigation ��───────────────────────────────
// Situational tools for cross-file investigation: finding definitions,
// references, and available completions. Use sparingly — each call
// targets a single position.

export const lspNavigationTools: ToolDef[] = [
  {
    name: "lsp_completion",
    method: "lsp.completion",
    description:
      "Completions at a position. Use limit=5 for targeted queries to save tokens. Only call when you need to discover available API.",
    inputSchema: {
      file_path: z
        .string()
        .describe(
          "Godot resource path (must start with res://, e.g. res://scripts/player.gd). Only .gd and .gdshader — not .cs",
        ),
      line: z.coerce.number().int().min(0).describe("Zero-based line number"),
      column: z.coerce.number().int().min(0).describe("Zero-based column number"),
      limit: z.coerce.number().int().min(1).max(50).default(10).optional().describe("Max items to return (default 10)"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "lsp_definition",
    method: "lsp.definition",
    description:
      "Go to definition: file + line where a symbol is defined. One position per call — use only when you need the source location.",
    inputSchema: {
      file_path: z
        .string()
        .describe(
          "Godot resource path (must start with res://, e.g. res://scripts/player.gd). Only .gd and .gdshader — not .cs",
        ),
      line: z.coerce.number().int().min(0).describe("Zero-based line number"),
      column: z.coerce.number().int().min(0).describe("Zero-based column number"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "lsp_references",
    method: "lsp.references",
    description:
      "Find all references to a symbol across the project. Use before renaming/removing to assess impact. One symbol per call.",
    inputSchema: {
      file_path: z
        .string()
        .describe(
          "Godot resource path (must start with res://, e.g. res://scripts/player.gd). Only .gd and .gdshader — not .cs",
        ),
      line: z.coerce.number().int().min(0).describe("Zero-based line number"),
      column: z.coerce.number().int().min(0).describe("Zero-based column number"),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];

/** All LSP tools combined (for catalogue/static checks). */
export const lspTools: ToolDef[] = [...lspAnalysisTools, ...lspNavigationTools];

// ── Handler factory ────────���─────────────────────────────────────────

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

/** Reset the LSP client (for config reload). */
export function resetLspClient(): void {
  if (_lspClient) {
    _lspClient.close().catch(() => {});
    _lspClient = null;
  }
}

/**
 * Create a handler for an LSP tool. Each handler:
 * 1. Validates input (rejects .cs files)
 * 2. Ensures LSP connection
 * 3. Reads file content and opens in LSP
 * 4. Sends the appropriate LSP request
 * 5. Converts URIs back to res:// paths
 */
export function createLspHandler(toolName: string, projectPath: string): (input: unknown) => Promise<ToolTextResult> {
  switch (toolName) {
    case "lsp_diagnostics":
      return (input) => handleDiagnostics(input, projectPath);
    case "lsp_hover":
      return (input) => handleHover(input, projectPath);
    case "lsp_completion":
      return (input) => handleCompletion(input, projectPath);
    case "lsp_definition":
      return (input) => handleDefinition(input, projectPath);
    case "lsp_symbols":
      return (input) => handleSymbols(input, projectPath);
    case "lsp_references":
      return (input) => handleReferences(input, projectPath);
    default:
      return async () => toolError("INTERNAL", `Unknown LSP tool: ${toolName}`);
  }
}

// ── Individual handlers ──────────────────────────────────────────────

async function ensureLsp(projectPath: string): Promise<ToolTextResult | LspClient> {
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
      `GDScript LSP unavailable: ${(err as Error).message}. Ensure the Godot editor is running.`,
    );
  }
}

async function readFileContent(filePath: string, projectPath: string): Promise<string | ToolTextResult> {
  const absPath = resToAbsolute(filePath, projectPath);
  try {
    return await readFile(absPath, "utf-8");
  } catch (err) {
    return toolError("READ_FAILED", `Cannot read ${filePath}: ${(err as Error).message}`);
  }
}

async function openDocInLsp(
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

async function handleDiagnostics(input: unknown, projectPath: string): Promise<ToolTextResult> {
  const { file_path } = input as { file_path: string };
  const pathErr = validateGdscriptPath(file_path);
  if (pathErr) return pathErr;

  const clientOrErr = await ensureLsp(projectPath);
  if ("content" in clientOrErr) return clientOrErr;
  const client = clientOrErr;

  const openResult = await openDocInLsp(client, file_path, projectPath);
  if ("content" in openResult) return openResult;

  // Wait for diagnostics notification from the LSP.
  const diagnostics = await client.waitForDiagnostics(openResult.uri);

  const formatted = diagnostics.map((d) => ({
    line: d.line + 1, // Convert to 1-based for user display.
    character: d.character + 1,
    severity: severityLabel(d.severity),
    message: d.message,
    ...(d.code != null ? { code: d.code } : {}),
  }));

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ success: true, file_path, diagnostics: formatted, count: formatted.length }),
      },
    ],
  };
}

async function handleHover(input: unknown, projectPath: string): Promise<ToolTextResult> {
  const { file_path, line, column } = input as { file_path: string; line: number; column: number };
  const pathErr = validateGdscriptPath(file_path);
  if (pathErr) return pathErr;

  const clientOrErr = await ensureLsp(projectPath);
  if ("content" in clientOrErr) return clientOrErr;
  const client = clientOrErr;

  const openResult = await openDocInLsp(client, file_path, projectPath);
  if ("content" in openResult) return openResult;

  const result = (await client.sendRequest("textDocument/hover", {
    textDocument: { uri: openResult.uri },
    position: { line, character: column },
  })) as { contents?: unknown } | null;

  if (!result || !result.contents) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ success: true, file_path, position: { line, column }, contents: null }),
        },
      ],
    };
  }

  // Extract hover text from LSP MarkupContent or string.
  let hoverText: string;
  if (typeof result.contents === "string") {
    hoverText = result.contents;
  } else if (typeof (result.contents as { value?: string }).value === "string") {
    hoverText = (result.contents as { value: string }).value;
  } else if (Array.isArray(result.contents)) {
    hoverText = result.contents
      .map((c: unknown) => (typeof c === "string" ? c : ((c as { value?: string }).value ?? "")))
      .join("\n");
  } else {
    hoverText = JSON.stringify(result.contents);
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          success: true,
          file_path,
          position: { line, column },
          contents: untrustedWrap("hover", "godot-lsp", hoverText),
        }),
      },
    ],
  };
}

async function handleCompletion(input: unknown, projectPath: string): Promise<ToolTextResult> {
  const { file_path, line, column, limit } = input as {
    file_path: string;
    line: number;
    column: number;
    limit?: number;
  };
  const pathErr = validateGdscriptPath(file_path);
  if (pathErr) return pathErr;

  const clientOrErr = await ensureLsp(projectPath);
  if ("content" in clientOrErr) return clientOrErr;
  const client = clientOrErr;

  const openResult = await openDocInLsp(client, file_path, projectPath);
  if ("content" in openResult) return openResult;

  const result = (await client.sendRequest("textDocument/completion", {
    textDocument: { uri: openResult.uri },
    position: { line, character: column },
  })) as { items?: unknown[] } | unknown[] | null;

  // LSP returns either CompletionList { items: [...] } or CompletionItem[].
  let items: unknown[];
  if (Array.isArray(result)) {
    items = result;
  } else if (result && Array.isArray((result as { items?: unknown[] }).items)) {
    items = (result as { items: unknown[] }).items;
  } else {
    items = [];
  }

  // Cap at limit and extract relevant fields.
  const maxItems = limit ?? 20;
  const completions = items.slice(0, maxItems).map((item: unknown) => {
    const c = item as { label?: string; kind?: number; detail?: string; documentation?: unknown; sortText?: string };
    return {
      label: c.label ?? "",
      kind: completionKindLabel(c.kind),
      ...(c.detail ? { detail: c.detail } : {}),
      ...(c.documentation
        ? {
            documentation:
              typeof c.documentation === "string" ? c.documentation : (c.documentation as { value?: string }).value,
          }
        : {}),
    };
  });

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          success: true,
          file_path,
          position: { line, column },
          completions,
          count: completions.length,
          total: items.length,
        }),
      },
    ],
  };
}

async function handleDefinition(input: unknown, projectPath: string): Promise<ToolTextResult> {
  const { file_path, line, column } = input as { file_path: string; line: number; column: number };
  const pathErr = validateGdscriptPath(file_path);
  if (pathErr) return pathErr;

  const clientOrErr = await ensureLsp(projectPath);
  if ("content" in clientOrErr) return clientOrErr;
  const client = clientOrErr;

  const openResult = await openDocInLsp(client, file_path, projectPath);
  if ("content" in openResult) return openResult;

  const result = (await client.sendRequest("textDocument/definition", {
    textDocument: { uri: openResult.uri },
    position: { line, character: column },
  })) as { uri?: string; range?: { start?: { line?: number; character?: number } } } | unknown[] | null;

  if (!result) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ success: true, file_path, position: { line, column }, definition: null }),
        },
      ],
    };
  }

  // LSP returns Location | Location[] | LocationLink[].
  const locations = Array.isArray(result) ? result : [result];
  const definitions = locations.map((loc: unknown) => {
    const l = loc as {
      uri?: string;
      targetUri?: string;
      range?: { start?: { line?: number; character?: number } };
      targetRange?: { start?: { line?: number; character?: number } };
    };
    const uri = l.uri ?? l.targetUri ?? "";
    const range = l.range ?? l.targetRange;
    return {
      file_path: fileUriToRes(uri, projectPath),
      line: (range?.start?.line ?? 0) + 1,
      column: (range?.start?.character ?? 0) + 1,
    };
  });

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          success: true,
          file_path,
          position: { line, column },
          definition: definitions.length === 1 ? definitions[0] : definitions,
        }),
      },
    ],
  };
}

async function handleSymbols(input: unknown, projectPath: string): Promise<ToolTextResult> {
  const { file_path } = input as { file_path: string };
  const pathErr = validateGdscriptPath(file_path);
  if (pathErr) return pathErr;

  const clientOrErr = await ensureLsp(projectPath);
  if ("content" in clientOrErr) return clientOrErr;
  const client = clientOrErr;

  const openResult = await openDocInLsp(client, file_path, projectPath);
  if ("content" in openResult) return openResult;

  const result = (await client.sendRequest("textDocument/documentSymbol", {
    textDocument: { uri: openResult.uri },
  })) as unknown[] | null;

  if (!result || !Array.isArray(result)) {
    return {
      content: [{ type: "text", text: JSON.stringify({ success: true, file_path, symbols: [], count: 0 }) }],
    };
  }

  const symbols = result.map(formatSymbol);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ success: true, file_path, symbols, count: symbols.length }),
      },
    ],
  };
}

async function handleReferences(input: unknown, projectPath: string): Promise<ToolTextResult> {
  const { file_path, line, column } = input as { file_path: string; line: number; column: number };
  const pathErr = validateGdscriptPath(file_path);
  if (pathErr) return pathErr;

  const clientOrErr = await ensureLsp(projectPath);
  if ("content" in clientOrErr) return clientOrErr;
  const client = clientOrErr;

  const openResult = await openDocInLsp(client, file_path, projectPath);
  if ("content" in openResult) return openResult;

  const result = (await client.sendRequest("textDocument/references", {
    textDocument: { uri: openResult.uri },
    position: { line, character: column },
    context: { includeDeclaration: true },
  })) as unknown[] | null;

  if (!result || !Array.isArray(result)) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ success: true, file_path, position: { line, column }, references: [], count: 0 }),
        },
      ],
    };
  }

  const references = result.map((loc: unknown) => {
    const l = loc as { uri?: string; range?: { start?: { line?: number; character?: number } } };
    return {
      file_path: fileUriToRes(l.uri ?? "", projectPath),
      line: (l.range?.start?.line ?? 0) + 1,
      column: (l.range?.start?.character ?? 0) + 1,
    };
  });

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          success: true,
          file_path,
          position: { line, column },
          references,
          count: references.length,
        }),
      },
    ],
  };
}

// ── Helpers ─────────────────────────────��────────────────────────────

function formatSymbol(sym: unknown): Record<string, unknown> {
  const s = sym as {
    name?: string;
    kind?: number;
    range?: { start?: { line?: number }; end?: { line?: number } };
    children?: unknown[];
  };
  const result: Record<string, unknown> = {
    name: s.name ?? "",
    kind: symbolKindLabel(s.kind),
    start_line: (s.range?.start?.line ?? 0) + 1,
    end_line: (s.range?.end?.line ?? 0) + 1,
  };
  if (s.children && s.children.length > 0) {
    result.children = s.children.map(formatSymbol);
  }
  return result;
}

function symbolKindLabel(kind?: number): string {
  const kinds: Record<number, string> = {
    1: "File",
    2: "Module",
    3: "Namespace",
    4: "Package",
    5: "Class",
    6: "Method",
    7: "Property",
    8: "Field",
    9: "Constructor",
    10: "Enum",
    11: "Interface",
    12: "Function",
    13: "Variable",
    14: "Constant",
    15: "String",
    16: "Number",
    17: "Boolean",
    18: "Array",
    19: "Object",
    20: "Key",
    21: "Null",
    22: "EnumMember",
    23: "Struct",
    24: "Event",
    25: "Operator",
    26: "TypeParameter",
  };
  return kinds[kind ?? 0] ?? "Unknown";
}

function completionKindLabel(kind?: number): string {
  const kinds: Record<number, string> = {
    1: "Text",
    2: "Method",
    3: "Function",
    4: "Constructor",
    5: "Field",
    6: "Variable",
    7: "Class",
    8: "Interface",
    9: "Module",
    10: "Property",
    11: "Unit",
    12: "Value",
    13: "Enum",
    14: "Keyword",
    15: "Snippet",
    16: "Color",
    17: "File",
    18: "Reference",
    19: "Folder",
    20: "EnumMember",
    21: "Constant",
    22: "Struct",
    23: "Event",
    24: "Operator",
    25: "TypeParameter",
  };
  return kinds[kind ?? 0] ?? "Unknown";
}
