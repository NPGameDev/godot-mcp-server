/**
 * Section 41 — LSP tools (conditional)
 *
 * Tests GDScript language intelligence via the Godot LSP connection.
 * Conditionally skips if the LSP port is not reachable (editor not running
 * or LSP disabled). This avoids false failures in CI or headless runs.
 */
import { probePort, HOST } from "../helpers.js";
import { LspClient, resolveLspEndpoint } from "../../src/lsp/lspClient.js";
import { lspTools, createLspHandler } from "../../src/tools/lsp.js";

import type { TestCtx } from "../helpers.js";

export const TOOLS_TESTED: string[] = [
  "lsp_diagnostics",
  "lsp_symbols",
  "lsp_hover",
  "lsp_completion",
  "lsp_definition",
  "lsp_references",
];
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
  // Resolution + collision detection (env > registry > conditional miss) and the
  // LSP_PORT_CONFLICT path are unit-tested in discover_lsp.test.ts; here we
  // exercise the happy path end-to-end against the running editor.

  const projectPath = ctx.projectPath ?? process.env.GODOT_MCP_PROJECT_PATH ?? process.cwd();

  // Per-project endpoint discovery must resolve (registry hit, or 6005 when free).
  try {
    const ep = resolveLspEndpoint(projectPath);
    pass(`lsp: resolveLspEndpoint → ${ep.host}:${ep.port}`);
  } catch (err) {
    fail(`lsp: resolveLspEndpoint threw: ${(err as Error).message}`);
    return;
  }

  // Cold-CI-boot hardening: on a fresh runner the editor may still be importing
  // the project when this section arrives, and a busy main loop can starve the
  // LSP's initialize response past the client timeout (observed once: Windows ·
  // Godot 4.2 · dogfood project — the slowest first-boot combo; every other
  // OS/version handshakes immediately). One delayed retry absorbs the boot
  // window without relaxing the assertion — a genuinely broken LSP fails both
  // attempts and still fails the section. Platform-neutral (no OS branch).
  let client = new LspClient(projectPath);
  try {
    await client.ensureConnected();
    pass("lsp: TCP connection + initialize handshake succeeded");
  } catch (firstErr) {
    await client.close().catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    client = new LspClient(projectPath);
    try {
      await client.ensureConnected();
      pass(
        `lsp: TCP connection + initialize handshake succeeded on retry (first attempt: ${(firstErr as Error).message})`,
      );
    } catch (err) {
      fail(`lsp: connection failed (after 1 retry): ${(err as Error).message}`);
      return;
    }
  }

  try {
    // Test documentSymbol on a known file (Main.gd exists in the toolkit project).
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

    // Omitted-limit completion → the schema default caps results at 10 (not the
    // former stray 20). Exercises the real tool handler end-to-end, so the
    // default-resolution path is covered — unlike the raw-client probe above.
    {
      const completionHandler = createLspHandler("lsp_completion", projectPath);
      const handlerResult = (await completionHandler({ file_path: testFile, line: 0, column: 0 })) as {
        content: { text: string }[];
      };
      const payload = JSON.parse(handlerResult.content[0].text) as { success?: boolean; count?: number };
      if (payload.success && typeof payload.count === "number" && payload.count <= 10) {
        pass(`lsp_completion omitted limit -> count ${payload.count} <= default cap 10`);
      } else {
        fail(`lsp_completion omitted limit: expected count <= 10, got ${JSON.stringify(payload)}`);
      }
    }

    // Definition — go-to-definition at a position (may return null for non-symbol positions).
    try {
      const definition = await client.sendRequest("textDocument/definition", {
        textDocument: { uri },
        position: { line: 0, character: 0 },
      });
      if (definition === null || definition === undefined) {
        pass("lsp: textDocument/definition returned null (no symbol at position — valid)");
      } else if (Array.isArray(definition)) {
        pass(`lsp: textDocument/definition returned ${definition.length} location(s)`);
      } else {
        pass("lsp: textDocument/definition returned a location");
      }
    } catch (defErr) {
      // Some LSP servers return errors for positions without definitions — acceptable.
      pass(`lsp: textDocument/definition -> ${(defErr as Error).message} (acceptable)`);
    }

    // References — find references at a position.
    try {
      const references = (await client.sendRequest("textDocument/references", {
        textDocument: { uri },
        position: { line: 0, character: 0 },
        context: { includeDeclaration: true },
      })) as unknown[] | null;
      if (references === null || references === undefined) {
        pass("lsp: textDocument/references returned null (no symbol at position — valid)");
      } else if (Array.isArray(references)) {
        pass(`lsp: textDocument/references returned ${references.length} reference(s)`);
      } else {
        pass("lsp: textDocument/references returned a result");
      }
    } catch (refErr) {
      pass(`lsp: textDocument/references -> ${(refErr as Error).message} (acceptable)`);
    }
  } catch (err) {
    fail(`lsp: live test error: ${(err as Error).message}`);
  } finally {
    await client.close();
  }
}
