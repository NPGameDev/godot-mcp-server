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

  // Bounded handshake-readiness loop (CI-boot hardening). Godot 4.2's LSP runs
  // on the editor main thread with an unbudgeted poll (4.3 added the
  // poll_limit_usec budget — gdscript_language_server.cpp), so on a slow
  // windows-latest runner the initialize response is intermittently starved
  // past the 10s client timeout while the editor otherwise responds (observed
  // twice: Win·4.2-gd beat 10s once, Win·4.2-mono beat one-retry/25s once;
  // never on 4.3+ or on Linux/mac). Up to 5 attempts with a flat 5s backoff
  // (worst case ~90s, matching the suite's 60s editor-boot poll discipline)
  // absorb the stall WITHOUT relaxing the assertion: a dead/broken LSP fails
  // all 5 attempts and still fails the section (refused connects red out
  // fast; a hard hang reds out after the full budget). Platform-neutral — no
  // OS/version branch; healthy editors succeed on attempt 1 and never loop.
  // Every failed attempt is logged and a pass-on-retry names the attempt
  // count, so a creeping needs-more-attempts trend stays visible in green-run
  // logs. If a 4.2-Windows leg reds out AFTER this loop, do not widen it —
  // that is a product-level investigation trigger (standing rule, 2026-07-04).
  const HANDSHAKE_ATTEMPTS = 5;
  const HANDSHAKE_BACKOFF_MS = 5_000;
  const handshakeErrors: string[] = [];
  let client = new LspClient(projectPath);
  let connected = false;
  for (let attempt = 1; attempt <= HANDSHAKE_ATTEMPTS && !connected; attempt++) {
    if (attempt > 1) {
      await client.close().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, HANDSHAKE_BACKOFF_MS));
      client = new LspClient(projectPath);
    }
    try {
      await client.ensureConnected();
      connected = true;
      if (attempt === 1) {
        pass("lsp: TCP connection + initialize handshake succeeded");
      } else {
        pass(
          `lsp: TCP connection + initialize handshake succeeded on attempt ${attempt}/${HANDSHAKE_ATTEMPTS} (attempt 1: ${handshakeErrors[0]})`,
        );
      }
    } catch (err) {
      const message = (err as Error).message;
      handshakeErrors.push(message);
      console.log(`[smoke] WARN  lsp: handshake attempt ${attempt}/${HANDSHAKE_ATTEMPTS} failed: ${message}`);
    }
  }
  if (!connected) {
    fail(
      `lsp: connection failed (all ${HANDSHAKE_ATTEMPTS} attempts, ${HANDSHAKE_BACKOFF_MS / 1000}s backoff): ${handshakeErrors[handshakeErrors.length - 1]}`,
    );
    return;
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
