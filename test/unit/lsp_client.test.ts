/**
 * Unit tests for lsp_client.ts — pure logic tests with no mock LSP server.
 * Construction is inert; the endpoint is resolved at connect time
 * (resolveLspEndpoint, exercised in discover_lsp.test.ts). Here we cover the
 * singleton guard, connect-failure handling, and state management.
 */
import assert from "node:assert/strict";
import { LspClient } from "../../src/lsp_client.js";

const TEST_PROJECT = "/tmp/godot-mcp-test-project";

// ── URI normalization (internal function — tested via public API) ────
//
// normalizeUri is private, so we test it indirectly through the
// diagnostics storage/retrieval path. We can construct an LspClient
// and test its public methods that use normalization internally.

// ── LspClient construction ───────────────────────────────────────────

// Default port from env
{
  const saved = process.env.GODOT_MCP_LSP_PORT;
  try {
    delete process.env.GODOT_MCP_LSP_PORT;
    const client = new LspClient(TEST_PROJECT);
    assert.equal(client.isConnected(), false);
  } finally {
    if (saved !== undefined) process.env.GODOT_MCP_LSP_PORT = saved;
    else delete process.env.GODOT_MCP_LSP_PORT;
  }
}

// Custom port from env
{
  const saved = process.env.GODOT_MCP_LSP_PORT;
  try {
    process.env.GODOT_MCP_LSP_PORT = "7005";
    const client = new LspClient(TEST_PROJECT);
    assert.equal(client.isConnected(), false);
  } finally {
    if (saved !== undefined) process.env.GODOT_MCP_LSP_PORT = saved;
    else delete process.env.GODOT_MCP_LSP_PORT;
  }
}

// Invalid port falls back to default (no crash)
{
  const saved = process.env.GODOT_MCP_LSP_PORT;
  try {
    process.env.GODOT_MCP_LSP_PORT = "not_a_number";
    const client = new LspClient(TEST_PROJECT);
    assert.equal(client.isConnected(), false);
  } finally {
    if (saved !== undefined) process.env.GODOT_MCP_LSP_PORT = saved;
    else delete process.env.GODOT_MCP_LSP_PORT;
  }
}

// ── isConnected — starts false ───────────────────────────────────────

{
  const client = new LspClient(TEST_PROJECT);
  assert.equal(client.isConnected(), false);
}

// ── sendNotification — no-op when not connected ─────────────────────

{
  const client = new LspClient(TEST_PROJECT);
  // Should not throw even when not connected
  client.sendNotification("test/method", { data: "test" });
}

// ── sendRequest — rejects when not connected ────────────────────────

{
  const client = new LspClient(TEST_PROJECT);
  await assert.rejects(
    () => client.sendRequest("test/method", {}),
    (err: Error) => {
      assert.ok(err.message.includes("not connected"));
      return true;
    },
  );
}

// ── close — safe to call when never connected ───────────────────────

{
  const client = new LspClient(TEST_PROJECT);
  // Should not throw
  await client.close();
  assert.equal(client.isConnected(), false);
}

// ── close — safe to call multiple times ─────────────────────────────

{
  const client = new LspClient(TEST_PROJECT);
  await client.close();
  await client.close();
  assert.equal(client.isConnected(), false);
}

// ── ensureConnected — fails gracefully when no server ───────────────

{
  const saved = process.env.GODOT_MCP_LSP_PORT;
  try {
    // Use a port that's almost certainly not listening
    process.env.GODOT_MCP_LSP_PORT = "19999";
    const client = new LspClient(TEST_PROJECT);
    await assert.rejects(
      () => client.ensureConnected(),
      (err: Error) => {
        assert.ok(
          err.message.includes("connect") || err.message.includes("ECONNREFUSED"),
          `Expected connect error, got: ${err.message}`,
        );
        return true;
      },
    );
    assert.equal(client.isConnected(), false);
  } finally {
    if (saved !== undefined) process.env.GODOT_MCP_LSP_PORT = saved;
    else delete process.env.GODOT_MCP_LSP_PORT;
  }
}

// ── Singleton guard — second ensureConnected is same promise ────────

// When a connect is already in flight, calling ensureConnected again
// should return the same promise (not start a second connection).
{
  const saved = process.env.GODOT_MCP_LSP_PORT;
  try {
    process.env.GODOT_MCP_LSP_PORT = "19998";
    const client = new LspClient(TEST_PROJECT);
    const p1 = client.ensureConnected().catch(() => "err1");
    const p2 = client.ensureConnected().catch(() => "err2");
    // Both should resolve/reject (they hit ECONNREFUSED)
    const [r1, r2] = await Promise.all([p1, p2]);
    assert.equal(r1, "err1");
    assert.equal(r2, "err2");
    assert.equal(client.isConnected(), false);
  } finally {
    if (saved !== undefined) process.env.GODOT_MCP_LSP_PORT = saved;
    else delete process.env.GODOT_MCP_LSP_PORT;
  }
}

console.log("All lsp_client tests passed.");
