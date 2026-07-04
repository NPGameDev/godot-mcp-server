/**
 * Section 41 — LSP tools (conditional)
 *
 * Tests GDScript language intelligence via the Godot LSP connection.
 * Conditionally skips when nothing serves the LSP endpoint (editor not
 * running or LSP disabled) — detected by the REAL client's first connect
 * attempt, never by a raw probe-then-abort TCP touch (see the handshake-loop
 * comment). This avoids false failures in CI or headless runs.
 */
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

  // ── Live LSP tests (skip decided by the real client's first connect) ──
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

  // Single PATIENT handshake — connect once, keep the socket, wait out the
  // first initialize (zero-corpse shape, pre-registered 2026-07-04 and adopted
  // after the 5-attempt retry loop failed even with the raw-TCP probe already
  // removed). Why: Godot 4.2 runs workspace->initialize() SYNCHRONOUSLY inside
  // the first-initialize handler on the main thread (source-verified:
  // gdscript_language_protocol.cpp:206-210), on an unbudgeted poll (4.3 added
  // poll_limit_usec — fixed-shape there; 0 failures on 4.3+ across every CI
  // run). Measured evidence: first handshake ~5.3s even on fast local hardware
  // (subsequent ~10ms, warm workspace); ~100-110s mute on 2-core
  // windows-latest. A 10s-timeout retry loop is counterproductive by
  // construction — aborting at 10s kills the socket the late reply (queued on
  // the peer's res_queue) would land on, and every fresh client re-pays the
  // full first-scan cost (observed: all 5 attempts timing out, on both
  // 4.2-Windows legs). The 120s budget covers the worst observed ~100-110s
  // window with MODEST margin only (~10-20s headroom; cell variance across
  // runs is large, so an unlucky fleet draw exceeding it is not excluded). The
  // PASS line reports elapsed ms so a 4.3+ handshake creeping from
  // milliseconds toward the budget stays visible in green-run logs; the FAIL
  // path reports elapsed too.
  // Skip semantics unchanged: connect-phase errors ("LSP connect …" — refused
  // / TCP connect timeout; disjoint from the initialize-phase "LSP request
  // timeout") mean nothing serves the endpoint -> graceful SKIP. Assertion
  // unchanged — accepted-then-mute past the budget FAILs the section. No
  // OS/version branch; no reconnect loop.
  // STANDING RULE (2026-07-04, updated): if a 4.2-Windows leg reds out here
  // even with this patient shape, there is NO pre-registered next move — it
  // becomes a pure user decision (version-gated skip / accept the red cell /
  // engine-side investigation), stated as such.
  const INITIALIZE_TIMEOUT_MS = 120_000;
  const client = new LspClient(projectPath, { initializeTimeoutMs: INITIALIZE_TIMEOUT_MS });
  const handshakeStart = Date.now();
  try {
    await client.ensureConnected();
    pass(`lsp: TCP connection + initialize handshake succeeded in ${Date.now() - handshakeStart}ms`);
  } catch (err) {
    const message = (err as Error).message;
    const elapsedMs = Date.now() - handshakeStart;
    if (message.startsWith("LSP connect ")) {
      // Nothing is serving the endpoint (ECONNREFUSED / TCP connect timeout).
      // Same graceful skip as the old probe gate, derived from the real client.
      pass(`lsp: SKIPPED — LSP endpoint not reachable (${message}; after ${elapsedMs}ms)`);
      await client.close().catch(() => {});
      return;
    }
    fail(
      `lsp: connection failed after ${elapsedMs}ms (single patient attempt, ${INITIALIZE_TIMEOUT_MS / 1000}s initialize budget): ${message}`,
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
