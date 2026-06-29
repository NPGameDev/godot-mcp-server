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
import { lspConnectFailureHint, lspTools } from "../../src/tools/lsp.js";

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

console.log("All lsp_tools tests passed.");
