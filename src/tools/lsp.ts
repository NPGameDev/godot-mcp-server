/**
 * LSP tool definitions — GDScript language intelligence via Godot's
 * built-in language server. All tools are read-only and group-only
 * (lazy-loaded via discover_tools → lsp_tools group).
 */
import { z } from "zod";

import type { ToolDef, ToolTextResult } from "../shared/types.js";
import { toolError } from "../shared/errorContract.js";
import { untrustedWrap } from "../security/untrusted.js";
import { fileUriToRes } from "../lsp/lspUri.js";
import { severityLabel, completionKindLabel, formatSymbol } from "../lsp/lspLabels.js";
import { withLspDoc } from "../lsp/lspSession.js";

// Re-export the session-layer symbols that external modules import from here,
// so their import paths stay stable.
export { setLspStatusReporter, lspConnectFailureHint } from "../lsp/lspSession.js";

// ── Tool definitions ─────────────���───────────────────────────────────

// ── Primary group: gdscript_analysis ─────────────────────────────────
// The 3 tools used most frequently during a write→validate→explore cycle.

export const lspAnalysisTools: ToolDef[] = [
  {
    name: "lsp_diagnostics",
    method: "lsp.diagnostics",
    description:
      "Rich GDScript diagnostics with column positions and severity (Error/Warning/Info/Hint). Needs editor running. " +
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
      limit: z.coerce.number().int().min(1).max(50).default(10).describe("Max items to return (default 10)"),
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

// Shader files get no real diagnostics from the Godot LSP — it analyzes GDScript
// only, and Godot exposes no offline shader-compile API. Every diagnostic the LSP
// would emit on a .gdshader/.gdshaderinc is a bogus GDScript-parse artifact (the
// 4.6/4.7 languageId:"gdshader" workaround suppresses them, but 4.2-4.5 ignore
// languageId). Short-circuit BEFORE touching the LSP so the empty result is
// uniform across 4.2-4.7 and needs no editor connection.
const SHADER_DIAGNOSTICS_NOTE =
  "lsp_diagnostics does not validate shader files — Godot's LSP analyzes GDScript only. " +
  "Real shader errors surface when the editor imports/compiles the shader (open it, or run the game); " +
  "read them with editor_get_console (level_filter:['error']).";

async function handleDiagnostics(input: unknown, projectPath: string): Promise<ToolTextResult> {
  const { file_path } = input as { file_path: string };

  if (file_path.endsWith(".gdshader") || file_path.endsWith(".gdshaderinc")) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            file_path,
            diagnostics: [],
            count: 0,
            note: SHADER_DIAGNOSTICS_NOTE,
          }),
        },
      ],
    };
  }

  const doc = await withLspDoc(file_path, projectPath);
  if ("content" in doc) return doc;
  const { client, uri } = doc;

  // Wait for diagnostics notification from the LSP.
  const diagnostics = await client.waitForDiagnostics(uri);

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
  const doc = await withLspDoc(file_path, projectPath);
  if ("content" in doc) return doc;
  const { client, uri } = doc;

  const result = (await client.sendRequest("textDocument/hover", {
    textDocument: { uri },
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

  // Hover markdown can embed file:// links to symbol definitions; convert the
  // in-project ones to res:// for consistency with lsp_definition/references
  // (fileUriToRes leaves out-of-project URIs untouched).
  hoverText = hoverText.replace(/file:\/\/[^\s)<>"'`\]]+/g, (fileUri) => fileUriToRes(fileUri, projectPath));

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
  const doc = await withLspDoc(file_path, projectPath);
  if ("content" in doc) return doc;
  const { client, uri } = doc;

  const result = (await client.sendRequest("textDocument/completion", {
    textDocument: { uri },
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
  const maxItems = limit ?? 10;
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
  const doc = await withLspDoc(file_path, projectPath);
  if ("content" in doc) return doc;
  const { client, uri } = doc;

  const result = (await client.sendRequest("textDocument/definition", {
    textDocument: { uri },
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
    const locUri = l.uri ?? l.targetUri ?? "";
    const range = l.range ?? l.targetRange;
    return {
      file_path: fileUriToRes(locUri, projectPath),
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
  const doc = await withLspDoc(file_path, projectPath);
  if ("content" in doc) return doc;
  const { client, uri } = doc;

  const result = (await client.sendRequest("textDocument/documentSymbol", {
    textDocument: { uri },
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
  const doc = await withLspDoc(file_path, projectPath);
  if ("content" in doc) return doc;
  const { client, uri } = doc;

  const result = (await client.sendRequest("textDocument/references", {
    textDocument: { uri },
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
