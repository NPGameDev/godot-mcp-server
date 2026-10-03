/**
 * Unit tests for resolveResponseCaps() — the response caps the environment sets.
 *
 * Pins "not configured" as undefined: the bridge pushes only the caps that are
 * defined, so a cap that came back as a default here would override the
 * project's own setting on every connect. Unset, empty and invalid values all
 * leave the cap undefined (an invalid one with a warning); a value below the
 * floor is still a configured cap and is clamped up to it.
 */
import assert from "node:assert/strict";
import { captureStderr, snapshotEnv } from "./helpers.js";
import { resolveResponseCaps } from "../../src/startup/startupEnv.js";

const SCRIPT_VAR = "GODOT_MCP_SCRIPT_READ_LIMIT";
const WS_VAR = "GODOT_MCP_WS_BUFFER_LIMIT";
const SCRIPT_READ_LIMIT_FLOOR = 65536;
const WS_BUFFER_LIMIT_FLOOR = 262144;

function clearCapEnv(): void {
  delete process.env[SCRIPT_VAR];
  delete process.env[WS_VAR];
}

// ── Neither var set → both caps undefined, silently ─────────────────
{
  const restoreEnv = snapshotEnv();
  const stderr = captureStderr();
  try {
    clearCapEnv();
    const caps = resolveResponseCaps();
    assert.equal(caps.scriptReadLimitBytes, undefined, "unset script cap is not configured");
    assert.equal(caps.wsBufferLimitBytes, undefined, "unset ws cap is not configured");
    assert.equal(stderr.output(), "", "an unset cap is not worth a warning");
  } finally {
    stderr.restore();
    restoreEnv();
  }
}

// ── Empty values count as unset ──────────────────────────────────────
{
  const restoreEnv = snapshotEnv();
  const stderr = captureStderr();
  try {
    clearCapEnv();
    process.env[SCRIPT_VAR] = "";
    process.env[WS_VAR] = "";
    const caps = resolveResponseCaps();
    assert.equal(caps.scriptReadLimitBytes, undefined, "empty script cap is not configured");
    assert.equal(caps.wsBufferLimitBytes, undefined, "empty ws cap is not configured");
    assert.equal(stderr.output(), "", "an empty cap is not worth a warning");
  } finally {
    stderr.restore();
    restoreEnv();
  }
}

// ── One var set → only that cap defined ──────────────────────────────
{
  const restoreEnv = snapshotEnv();
  try {
    clearCapEnv();
    process.env[SCRIPT_VAR] = "524288";
    let caps = resolveResponseCaps();
    assert.equal(caps.scriptReadLimitBytes, 524288, "the set script cap passes through in bytes");
    assert.equal(caps.wsBufferLimitBytes, undefined, "the unset ws cap stays undefined");

    clearCapEnv();
    process.env[WS_VAR] = "2097152";
    caps = resolveResponseCaps();
    assert.equal(caps.scriptReadLimitBytes, undefined, "the unset script cap stays undefined");
    assert.equal(caps.wsBufferLimitBytes, 2097152, "the set ws cap passes through in bytes");
  } finally {
    restoreEnv();
  }
}

// ── Below the floor → clamped to the floor, with a warning ──────────
{
  const restoreEnv = snapshotEnv();
  const stderr = captureStderr();
  try {
    clearCapEnv();
    process.env[SCRIPT_VAR] = "1000";
    process.env[WS_VAR] = "1000";
    const caps = resolveResponseCaps();
    assert.equal(
      caps.scriptReadLimitBytes,
      SCRIPT_READ_LIMIT_FLOOR,
      "a low script cap is still configured, at the floor",
    );
    assert.equal(caps.wsBufferLimitBytes, WS_BUFFER_LIMIT_FLOOR, "a low ws cap is still configured, at the floor");
    assert.ok(stderr.output().includes(`${SCRIPT_VAR}=1000 is below minimum`), "the script clamp is reported");
    assert.ok(stderr.output().includes(`${WS_VAR}=1000 is below minimum`), "the ws clamp is reported");
  } finally {
    stderr.restore();
    restoreEnv();
  }
}

// ── Invalid (non-numeric, zero, negative) → ignored, with a warning ─
for (const bad of ["lots", "0", "-4096"]) {
  const restoreEnv = snapshotEnv();
  const stderr = captureStderr();
  try {
    clearCapEnv();
    process.env[SCRIPT_VAR] = bad;
    process.env[WS_VAR] = bad;
    const caps = resolveResponseCaps();
    assert.equal(caps.scriptReadLimitBytes, undefined, `script cap "${bad}" is ignored, not replaced by a default`);
    assert.equal(caps.wsBufferLimitBytes, undefined, `ws cap "${bad}" is ignored, not replaced by a default`);
    const output = stderr.output();
    assert.ok(output.includes(`${SCRIPT_VAR}=${bad} is not a valid positive number; ignoring it`), "script warning");
    assert.ok(output.includes(`${WS_VAR}=${bad} is not a valid positive number; ignoring it`), "ws warning");
  } finally {
    stderr.restore();
    restoreEnv();
  }
}

console.log("All responseCaps tests passed.");
