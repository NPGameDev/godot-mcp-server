/**
 * Unit tests for config_reload.ts — pure functions only.
 * Tests readMcpJsonEnv (parse .mcp.json env block) and
 * applyEnvUpdate (env var sync with GODOT_MCP_* prefix filtering).
 */
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { snapshotEnv } from "./helpers.js";
import { readMcpJsonEnv, applyEnvUpdate } from "../../src/startup/configReload.js";

const tmpDir = mkdtempSync(join(tmpdir(), "mcp-cfg-test-"));

function writeMcpJson(projectPath: string, content: unknown): void {
  writeFileSync(join(projectPath, ".mcp.json"), JSON.stringify(content), "utf-8");
}

// ── readMcpJsonEnv tests ─────────────────────────────────────────────

// Exact key match: "godot-mcp-toolkit"
{
  const dir = join(tmpDir, "exact-key");
  mkdirSync(dir, { recursive: true });
  writeMcpJson(dir, {
    mcpServers: {
      "godot-mcp-toolkit": { env: { GODOT_MCP_EDITOR_PORT: "7000", GODOT_MCP_READ_ONLY: "1" } },
    },
  });
  const env = readMcpJsonEnv(dir);
  assert.deepEqual(env, { GODOT_MCP_EDITOR_PORT: "7000", GODOT_MCP_READ_ONLY: "1" });
}

// Fuzzy key match: any key containing "godot-mcp"
{
  const dir = join(tmpDir, "fuzzy-key");
  mkdirSync(dir, { recursive: true });
  writeMcpJson(dir, {
    mcpServers: {
      "@npgamedev/godot-mcp-server": { env: { GODOT_MCP_EDITOR_PORT: "8000" } },
    },
  });
  const env = readMcpJsonEnv(dir);
  assert.deepEqual(env, { GODOT_MCP_EDITOR_PORT: "8000" });
}

// Exact key takes priority over fuzzy
{
  const dir = join(tmpDir, "exact-priority");
  mkdirSync(dir, { recursive: true });
  writeMcpJson(dir, {
    mcpServers: {
      "godot-mcp-toolkit": { env: { GODOT_MCP_EDITOR_PORT: "6550" } },
      "@npgamedev/godot-mcp-server": { env: { GODOT_MCP_EDITOR_PORT: "9999" } },
    },
  });
  const env = readMcpJsonEnv(dir);
  assert.deepEqual(env, { GODOT_MCP_EDITOR_PORT: "6550" });
}

// Missing .mcp.json file → undefined
{
  const dir = join(tmpDir, "missing-file");
  mkdirSync(dir, { recursive: true });
  const env = readMcpJsonEnv(dir);
  assert.equal(env, undefined);
}

// Missing mcpServers key → undefined
{
  const dir = join(tmpDir, "no-servers");
  mkdirSync(dir, { recursive: true });
  writeMcpJson(dir, { someOtherKey: {} });
  const env = readMcpJsonEnv(dir);
  assert.equal(env, undefined);
}

// No matching server key → undefined
{
  const dir = join(tmpDir, "no-match");
  mkdirSync(dir, { recursive: true });
  writeMcpJson(dir, {
    mcpServers: {
      "some-other-server": { env: { FOO: "bar" } },
    },
  });
  const env = readMcpJsonEnv(dir);
  assert.equal(env, undefined);
}

// Server entry without env → undefined
{
  const dir = join(tmpDir, "no-env");
  mkdirSync(dir, { recursive: true });
  writeMcpJson(dir, {
    mcpServers: {
      "godot-mcp-toolkit": { command: "npx" },
    },
  });
  const env = readMcpJsonEnv(dir);
  assert.equal(env, undefined);
}

// Malformed JSON → undefined (no crash)
{
  const dir = join(tmpDir, "malformed");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".mcp.json"), "not valid json {{{", "utf-8");
  const env = readMcpJsonEnv(dir);
  assert.equal(env, undefined);
}

// ── applyEnvUpdate tests ─────────────────────────────────────────────

// Adds new GODOT_MCP_* vars
{
  const restore = snapshotEnv();
  try {
    delete process.env.GODOT_MCP_TEST_ADD;
    applyEnvUpdate({ GODOT_MCP_TEST_ADD: "hello" });
    assert.equal(process.env.GODOT_MCP_TEST_ADD, "hello");
  } finally {
    restore();
  }
}

// Updates existing GODOT_MCP_* vars
{
  const restore = snapshotEnv();
  try {
    process.env.GODOT_MCP_TEST_UPD = "old";
    applyEnvUpdate({ GODOT_MCP_TEST_UPD: "new" });
    assert.equal(process.env.GODOT_MCP_TEST_UPD, "new");
  } finally {
    restore();
  }
}

// Removes GODOT_MCP_* vars no longer present in newEnv
{
  const restore = snapshotEnv();
  try {
    process.env.GODOT_MCP_REMOVED = "gone";
    applyEnvUpdate({});
    assert.equal(process.env.GODOT_MCP_REMOVED, undefined);
  } finally {
    restore();
  }
}

// Does NOT remove non-GODOT_MCP_* vars
{
  const restore = snapshotEnv();
  try {
    process.env.MY_CUSTOM_VAR = "keep";
    applyEnvUpdate({});
    assert.equal(process.env.MY_CUSTOM_VAR, "keep");
  } finally {
    restore();
  }
}

// Sets non-GODOT_MCP vars passed in newEnv (applyEnvUpdate sets all keys)
{
  const restore = snapshotEnv();
  try {
    applyEnvUpdate({ OTHER_VAR: "set" });
    assert.equal(process.env.OTHER_VAR, "set");
  } finally {
    restore();
  }
}

// Coerces non-string values to string
{
  const restore = snapshotEnv();
  try {
    applyEnvUpdate({ GODOT_MCP_NUM: 42 as unknown as string });
    assert.equal(process.env.GODOT_MCP_NUM, "42");
  } finally {
    restore();
  }
}

// Cleanup
rmSync(tmpDir, { recursive: true, force: true });

console.log("All config_reload tests passed.");
