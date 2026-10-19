/**
 * Unit tests for buildBridgeOptions(): the seam that carries the resolved startup
 * configuration into createBridge.
 *
 * Pins the wiring from resolveResponseCaps() to the bridge: a cap the environment
 * sets must reach the bridge options, or the bridge never pushes it as an env
 * override. The resolved ports and project path ride the same object, so they are
 * pinned here too, as is the version-check opt-out resolveSkipVersionCheck() reads
 * from GODOT_MCP_SKIP_VERSION_CHECK.
 */
import assert from "node:assert/strict";
import { captureStderr, snapshotEnv } from "./helpers.js";
import { buildBridgeOptions } from "../../src/startup/bridgeOptions.js";
import { resolveResponseCaps, resolveSkipVersionCheck } from "../../src/startup/startupEnv.js";
import type { ResolvedPortConfig } from "../../src/startup/portConfig.js";

const PORTS: ResolvedPortConfig = {
  editorPort: "6551",
  editorPinned: true,
  editorSource: "env",
  runtimePort: "6560",
  runtimeSource: "env",
  lspPort: undefined,
  lspHost: undefined,
  lspSource: "default",
};

// ── Both caps set → both reach the bridge options, in bytes ─────────
{
  const restoreEnv = snapshotEnv();
  try {
    process.env.GODOT_MCP_SCRIPT_READ_LIMIT = "524288";
    process.env.GODOT_MCP_WS_BUFFER_LIMIT = "2097152";
    const opts = buildBridgeOptions("/project", PORTS, resolveResponseCaps(), false);
    assert.equal(opts.scriptReadLimitBytes, 524288, "the env-set script cap reaches the bridge");
    assert.equal(opts.wsBufferLimitBytes, 2097152, "the env-set ws cap reaches the bridge");
    assert.equal(opts.projectPath, "/project", "the project path reaches the bridge");
    assert.equal(opts.explicitEditorPort, true, "an editor pin reaches the bridge");
    assert.equal(opts.explicitRuntimePort, "6560", "a runtime pin reaches the bridge");
  } finally {
    restoreEnv();
  }
}

// ── No cap set → neither cap in the options, so the push carries none ─
{
  const restoreEnv = snapshotEnv();
  try {
    delete process.env.GODOT_MCP_SCRIPT_READ_LIMIT;
    delete process.env.GODOT_MCP_WS_BUFFER_LIMIT;
    const opts = buildBridgeOptions(
      "/project",
      { ...PORTS, editorPinned: false, runtimePort: undefined },
      resolveResponseCaps(),
      false,
    );
    assert.equal(opts.scriptReadLimitBytes, undefined, "an unset script cap stays undefined");
    assert.equal(opts.wsBufferLimitBytes, undefined, "an unset ws cap stays undefined");
    assert.equal(opts.explicitEditorPort, false, "an unpinned editor port stays unpinned");
    assert.equal(opts.explicitRuntimePort, undefined, "no runtime pin stays undefined");
  } finally {
    restoreEnv();
  }
}

// ── GODOT_MCP_SKIP_VERSION_CHECK=1 → the opt-out reaches the bridge, said once ─
{
  const restoreEnv = snapshotEnv();
  const cap = captureStderr();
  try {
    process.env.GODOT_MCP_SKIP_VERSION_CHECK = "1";
    const opts = buildBridgeOptions("/project", PORTS, {}, resolveSkipVersionCheck());
    assert.equal(opts.skipVersionCheck, true, "the env opt-out reaches the bridge");
    assert.equal(
      cap.output(),
      "[bridge] version check skipped (GODOT_MCP_SKIP_VERSION_CHECK)\n",
      "one stderr line says the check is skipped",
    );
  } finally {
    cap.restore();
    restoreEnv();
  }
}

// ── Any other value, or none → the check stays on, nothing printed ──
for (const value of [undefined, "", "0", "true", "yes"]) {
  const restoreEnv = snapshotEnv();
  const cap = captureStderr();
  try {
    if (value === undefined) delete process.env.GODOT_MCP_SKIP_VERSION_CHECK;
    else process.env.GODOT_MCP_SKIP_VERSION_CHECK = value;
    const opts = buildBridgeOptions("/project", PORTS, {}, resolveSkipVersionCheck());
    assert.equal(opts.skipVersionCheck, false, `GODOT_MCP_SKIP_VERSION_CHECK=${String(value)} leaves the check on`);
    assert.equal(cap.output(), "", `GODOT_MCP_SKIP_VERSION_CHECK=${String(value)} prints nothing`);
  } finally {
    cap.restore();
    restoreEnv();
  }
}

console.log("All bridgeOptions tests passed.");
