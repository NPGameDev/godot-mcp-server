/**
 * Unit tests for feature_gate.ts — env var checks, feature-to-env mapping,
 * and complete feature list.
 */
import assert from "node:assert/strict";
import { snapshotEnv } from "./helpers.js";
import { isEnabled, envVarFor, allFeatures } from "../../src/feature_gate.js";

// ── isEnabled ────────────────────────────────────────────────────────

// execute_code enabled
{
  const restore = snapshotEnv();
  try {
    process.env.GODOT_MCP_ALLOW_EXECUTE_CODE = "1";
    assert.equal(isEnabled("execute_code"), true);
  } finally {
    restore();
  }
}

// execute_code disabled (not set)
{
  const restore = snapshotEnv();
  try {
    delete process.env.GODOT_MCP_ALLOW_EXECUTE_CODE;
    assert.equal(isEnabled("execute_code"), false);
  } finally {
    restore();
  }
}

// execute_code disabled ("0" is not "1")
{
  const restore = snapshotEnv();
  try {
    process.env.GODOT_MCP_ALLOW_EXECUTE_CODE = "0";
    assert.equal(isEnabled("execute_code"), false);
  } finally {
    restore();
  }
}

// "true" is not "1"
{
  const restore = snapshotEnv();
  try {
    process.env.GODOT_MCP_ALLOW_EXECUTE_CODE = "true";
    assert.equal(isEnabled("execute_code"), false);
  } finally {
    restore();
  }
}

// Empty string is not "1"
{
  const restore = snapshotEnv();
  try {
    process.env.GODOT_MCP_ALLOW_EXECUTE_CODE = "";
    assert.equal(isEnabled("execute_code"), false);
  } finally {
    restore();
  }
}

// node_call_method
{
  const restore = snapshotEnv();
  try {
    process.env.GODOT_MCP_ALLOW_NODE_CALL_METHOD = "1";
    assert.equal(isEnabled("node_call_method"), true);
    delete process.env.GODOT_MCP_ALLOW_NODE_CALL_METHOD;
    assert.equal(isEnabled("node_call_method"), false);
  } finally {
    restore();
  }
}

// read_user_scope
{
  const restore = snapshotEnv();
  try {
    process.env.GODOT_MCP_ALLOW_USER_SCOPE = "1";
    assert.equal(isEnabled("read_user_scope"), true);
    delete process.env.GODOT_MCP_ALLOW_USER_SCOPE;
    assert.equal(isEnabled("read_user_scope"), false);
  } finally {
    restore();
  }
}

// Unknown feature → false (no env var mapping)
{
  assert.equal(isEnabled("nonexistent_feature"), false);
}

// ── envVarFor ────────────────────────────────────────────────────────

assert.equal(envVarFor("execute_code"), "GODOT_MCP_ALLOW_EXECUTE_CODE");
assert.equal(envVarFor("node_call_method"), "GODOT_MCP_ALLOW_NODE_CALL_METHOD");
assert.equal(envVarFor("read_user_scope"), "GODOT_MCP_ALLOW_USER_SCOPE");

// Unknown feature → undefined
assert.equal(envVarFor("nonexistent"), undefined);

// ── allFeatures ──────────────────────────────────────────────────────

{
  const features = allFeatures();
  assert.ok(Array.isArray(features));
  assert.equal(features.length, 3);
  assert.ok(features.includes("execute_code"));
  assert.ok(features.includes("node_call_method"));
  assert.ok(features.includes("read_user_scope"));
}

// allFeatures matches envVarFor — every feature has a mapping
{
  for (const feature of allFeatures()) {
    const envVar = envVarFor(feature);
    assert.ok(envVar !== undefined, `Feature "${feature}" should have an env var mapping`);
    assert.ok(envVar!.startsWith("GODOT_MCP_"), `Env var for "${feature}" should start with GODOT_MCP_`);
  }
}

console.log("All feature_gate tests passed.");
