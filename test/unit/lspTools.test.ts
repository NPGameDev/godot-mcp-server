/**
 * Unit tests for tools/lsp.ts pure helpers.
 *
 * Covers lspConnectFailureHint — the hint attached to the LSP_UNAVAILABLE
 * response when a raw socket connect fails (e.g. ECONNREFUSED). The hint must
 * name the GODOT_MCP_LSP_PORT override and the tried port, and lead with the
 * port-mismatch cause rather than "editor not running" (the editor is usually
 * up when this fires). Pure-function test — no client, no socket.
 */
import assert from "node:assert/strict";
import { z } from "zod";
import { lspConnectFailureHint, lspTools, createLspHandler } from "../../src/tools/lsp.js";

// ── lspConnectFailureHint — names the env lever and the tried port ──

{
  const hint = lspConnectFailureHint(6005);
  assert.ok(hint.includes("GODOT_MCP_LSP_PORT"), "connect-failure hint names the GODOT_MCP_LSP_PORT override");
  assert.ok(hint.includes("6005"), "connect-failure hint names the tried port");
}

// Tried port is interpolated, not hard-coded to the 6005 default.
{
  const hint = lspConnectFailureHint(6010);
  assert.ok(hint.includes("6010"), "connect-failure hint interpolates the actual tried port");
}

// ── lsp_completion: an omitted limit resolves to the declared default of 10 ──
// The schema declares default(10); a trailing .optional() made Zod short-circuit on
// undefined and skip the default, so an omitted limit never reached the contract
// value. Parsing the schema directly is the SSOT check — no editor needed.
{
  const completionTool = lspTools.find((t) => t.name === "lsp_completion");
  assert.ok(completionTool, "lsp_completion tool is defined");
  const schema = z.object(completionTool.inputSchema);

  const omitted = schema.parse({ file_path: "res://x.gd", line: 0, column: 0 }) as { limit?: number };
  assert.equal(omitted.limit, 10, "omitted limit resolves to the declared default of 10");

  const explicit = schema.parse({ file_path: "res://x.gd", line: 0, column: 5, limit: 3 }) as { limit?: number };
  assert.equal(explicit.limit, 3, "an explicit limit is respected");
}

// ── lsp_diagnostics: shader files short-circuit BEFORE the LSP ──
// A .gdshader/.gdshaderinc returns an empty, version-uniform result with an
// explanatory note and NEVER opens an LSP connection (the Godot LSP analyzes
// GDScript only — every diagnostic it would emit on a shader is a bogus parse
// artifact). Proof that no connect happens: point GODOT_MCP_LSP_PORT at a closed
// port — a real connect attempt would yield an LSP_UNAVAILABLE error result, so a
// clean success here means the handler returned before touching the socket.
{
  const prevPort = process.env.GODOT_MCP_LSP_PORT;
  process.env.GODOT_MCP_LSP_PORT = "59999"; // Closed — a connect would fail loudly.
  try {
    const handler = createLspHandler("lsp_diagnostics", process.cwd());

    for (const ext of [".gdshader", ".gdshaderinc"]) {
      const result = (await handler({ file_path: `res://fx/test${ext}` })) as {
        content: { text: string }[];
        isError?: true;
      };
      assert.ok(!result.isError, `${ext}: short-circuit returns a success result, not an error`);

      const payload = JSON.parse(result.content[0].text) as {
        success?: boolean;
        diagnostics?: unknown[];
        count?: number;
        note?: string;
      };
      assert.equal(payload.success, true, `${ext}: success is true`);
      assert.deepEqual(payload.diagnostics, [], `${ext}: diagnostics is empty`);
      assert.equal(payload.count, 0, `${ext}: count is 0`);
      assert.ok(typeof payload.note === "string" && payload.note.length > 0, `${ext}: carries an explanatory note`);
      assert.match(payload.note!, /shader/i, `${ext}: note explains shaders are not validated`);
      assert.ok(payload.note!.includes("editor_get_console"), `${ext}: note points to editor_get_console`);
    }
  } finally {
    if (prevPort === undefined) delete process.env.GODOT_MCP_LSP_PORT;
    else process.env.GODOT_MCP_LSP_PORT = prevPort;
  }
}

console.log("All lsp_tools tests passed.");
