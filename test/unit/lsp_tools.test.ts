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
import { lspConnectFailureHint } from "../../src/tools/lsp.js";

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

console.log("All lsp_tools tests passed.");
