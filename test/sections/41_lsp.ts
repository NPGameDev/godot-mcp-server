/**
 * Section 41 — LSP tools (conditional)
 *
 * Tests GDScript language intelligence via the Godot LSP connection.
 * Conditionally skips if port 6005 is not reachable (editor not running
 * or LSP disabled). This avoids false failures in CI or headless runs.
 */
import { probePort, HOST } from "../helpers.js";
import { LspClient } from "../../src/lsp_client.js";
import { lspTools, lspAnalysisTools, lspNavigationTools } from "../../src/tools/lsp.js";

import type { TestCtx } from "../helpers.js";

const LSP_PORT = Number(process.env.GODOT_MCP_LSP_PORT ?? "6005");

export async function testLsp(ctx: TestCtx): Promise<void> {
  const { pass, fail } = ctx;

  // ── Static checks (always run) ──

  // All LSP tool descriptions <= 200 chars (I2).
  for (const tool of lspTools) {
    if (tool.description.length > 200) {
      fail(`lsp ${tool.name} description ${tool.description.length} > 200 chars`);
    }
  }
  pass(`lsp: all ${lspTools.length} tool descriptions <= 200 chars`);

  // All LSP tools have read-only annotations.
  for (const tool of lspTools) {
    if (!tool.annotations?.readOnlyHint) {
      fail(`lsp ${tool.name} missing readOnlyHint annotation`);
    }
  }
  pass("lsp: all tools have readOnlyHint=true annotation");

  // Tool count.
  if (lspTools.length !== 6) {
    fail(`lsp: expected 6 tools, got ${lspTools.length}`);
  } else {
    pass("lsp: 6 tools defined");
  }

  // ── Connectivity check ──

  const lspReachable = await probePort(HOST, LSP_PORT, 2000);
  if (!lspReachable) {
    pass(`lsp: SKIPPED — port ${LSP_PORT} not reachable (editor LSP not running)`);
    return;
  }

  // ── Live LSP tests (only when port is reachable) ──

  const client = new LspClient();
  try {
    await client.ensureConnected();
    pass("lsp: TCP connection + initialize handshake succeeded");
  } catch (err) {
    fail(`lsp: connection failed: ${(err as Error).message}`);
    return;
  }

  try {
    // Test documentSymbol on a known file (Main.gd exists in the toolkit project).
    const projectPath = ctx.projectPath ?? process.env.GODOT_MCP_PROJECT_PATH ?? process.cwd();
    const testFile = "res://Main.gd";
    const absPath = testFile.replace(/^res:\/\//, "");
    const fullPath = `${projectPath.replace(/\\/g, "/")}/${absPath}`;
    const uri = /^[A-Za-z]:/.test(fullPath) ? `file:///${fullPath}` : `file://${fullPath}`;

    // Read file content for didOpen.
    let content: string;
    try {
      const { readFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      content = await readFile(join(projectPath, absPath), "utf-8");
    } catch {
      pass("lsp: SKIPPED live tests — Main.gd not found in project");
      return;
    }

    // Open document.
    await client.openDocument(uri, content);
    pass("lsp: textDocument/didOpen sent successfully");

    // DocumentSymbol request.
    const symbols = (await client.sendRequest("textDocument/documentSymbol", {
      textDocument: { uri },
    })) as unknown[] | null;
    if (Array.isArray(symbols)) {
      pass(`lsp: documentSymbol returned ${symbols.length} symbol(s)`);
    } else {
      fail(`lsp: documentSymbol returned non-array: ${JSON.stringify(symbols)}`);
    }

    // Hover at line 0, col 0 (may return null — that's OK).
    const hover = await client.sendRequest("textDocument/hover", {
      textDocument: { uri },
      position: { line: 0, character: 0 },
    });
    // Hover can be null if nothing is at position 0,0 — both outcomes are valid.
    pass(`lsp: textDocument/hover returned ${hover ? "content" : "null"} (both valid)`);

    // Completion at a position.
    const completion = (await client.sendRequest("textDocument/completion", {
      textDocument: { uri },
      position: { line: 0, character: 0 },
    })) as { items?: unknown[] } | unknown[] | null;
    const items = Array.isArray(completion)
      ? completion
      : completion && Array.isArray((completion as { items?: unknown[] }).items)
        ? (completion as { items: unknown[] }).items
        : [];
    pass(`lsp: textDocument/completion returned ${items.length} item(s)`);
  } catch (err) {
    fail(`lsp: live test error: ${(err as Error).message}`);
  } finally {
    await client.close();
  }
}
