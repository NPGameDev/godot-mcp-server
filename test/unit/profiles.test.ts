/**
 * Unit tests for profiles.ts — annotation-based filtering, mode detection,
 * and tool set resolution.
 */
import assert from "node:assert/strict";
import { snapshotEnv, captureStderr } from "./helpers.js";
import {
  isAllowedInReadOnly,
  isExcludedByReadOnly,
  isReadOnly,
  resolveAllowedTools,
  STANDARD_TOOLS,
} from "../../src/profiles.js";

// ── isAllowedInReadOnly ──────────────────────────────────────────────

// readOnlyHint: true → allowed
assert.equal(isAllowedInReadOnly({ readOnlyHint: true }), true);

// readOnlyHint: false → excluded
assert.equal(isAllowedInReadOnly({ readOnlyHint: false }), false);

// No annotations → excluded (safe default)
assert.equal(isAllowedInReadOnly(undefined), false);
assert.equal(isAllowedInReadOnly({}), false);

// Contradiction: readOnlyHint + destructiveHint → excluded with warning
{
  const stderr = captureStderr();
  try {
    const result = isAllowedInReadOnly({ readOnlyHint: true, destructiveHint: true });
    assert.equal(result, false);
    assert.ok(stderr.output().includes("WARNING"));
    assert.ok(stderr.output().includes("readOnlyHint"));
    assert.ok(stderr.output().includes("destructiveHint"));
  } finally {
    stderr.restore();
  }
}

// destructiveHint only (no readOnlyHint) → excluded
assert.equal(isAllowedInReadOnly({ destructiveHint: true }), false);

// ── isExcludedByReadOnly ─────────────────────────────────────────────

// Not read-only mode → never excluded
assert.equal(isExcludedByReadOnly(false, { readOnlyHint: false }), false);
assert.equal(isExcludedByReadOnly(false, undefined), false);

// Read-only mode + readOnlyHint: true → not excluded
assert.equal(isExcludedByReadOnly(true, { readOnlyHint: true }), false);

// Read-only mode + readOnlyHint: false → excluded
assert.equal(isExcludedByReadOnly(true, { readOnlyHint: false }), true);

// Read-only mode + no annotations → excluded (safe default)
assert.equal(isExcludedByReadOnly(true, undefined), true);
assert.equal(isExcludedByReadOnly(true, {}), true);

// ── isReadOnly ───────────────────────────────────────────────────────

// Env var not set → false
{
  const restore = snapshotEnv();
  try {
    delete process.env.GODOT_MCP_READ_ONLY;
    assert.equal(isReadOnly(), false);
  } finally {
    restore();
  }
}

// Env var = "1" → true
{
  const restore = snapshotEnv();
  try {
    process.env.GODOT_MCP_READ_ONLY = "1";
    assert.equal(isReadOnly(), true);
  } finally {
    restore();
  }
}

// Env var = "0" → false (strict equality)
{
  const restore = snapshotEnv();
  try {
    process.env.GODOT_MCP_READ_ONLY = "0";
    assert.equal(isReadOnly(), false);
  } finally {
    restore();
  }
}

// Env var = "true" → false (only "1" is truthy)
{
  const restore = snapshotEnv();
  try {
    process.env.GODOT_MCP_READ_ONLY = "true";
    assert.equal(isReadOnly(), false);
  } finally {
    restore();
  }
}

// ── resolveAllowedTools ──────────────────────────────────────────────

// Returns a Set of all STANDARD_TOOLS
{
  const allowed = resolveAllowedTools();
  assert.ok(allowed instanceof Set);
  assert.equal(allowed.size, STANDARD_TOOLS.length);
  for (const tool of STANDARD_TOOLS) {
    assert.ok(allowed.has(tool), `Missing standard tool: ${tool}`);
  }
}

// Contains known standard tools
{
  const allowed = resolveAllowedTools();
  assert.ok(allowed.has("scene_get_tree"));
  assert.ok(allowed.has("script_read"));
  assert.ok(allowed.has("editor_save_scene"));
  assert.ok(allowed.has("game_start"));
  assert.ok(allowed.has("execute_code"));
}

console.log("All profiles tests passed.");
