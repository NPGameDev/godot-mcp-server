/**
 * Unit tests for resolveProjectPath(): which Godot project the server serves.
 *
 * An unset or empty GODOT_MCP_PROJECT_PATH falls back to the working directory,
 * because an empty project path can never authenticate; any other value, a
 * whitespace-only one included, is used as given.
 */
import assert from "node:assert/strict";
import { resolveProjectPath } from "../../src/startup/projectPath.js";

const CWD = "/work/dir";

// ── Unset → the working directory ────────────────────────────────────
assert.equal(resolveProjectPath({}, CWD), CWD, "an unset variable falls back to cwd");

// ── Empty → the working directory, as if unset ───────────────────────
assert.equal(resolveProjectPath({ GODOT_MCP_PROJECT_PATH: "" }, CWD), CWD, "an empty variable falls back to cwd");

// ── A path → that path ───────────────────────────────────────────────
assert.equal(
  resolveProjectPath({ GODOT_MCP_PROJECT_PATH: "/games/demo" }, CWD),
  "/games/demo",
  "a set variable names the project",
);

// ── Whitespace only → kept as given ──────────────────────────────────
assert.equal(resolveProjectPath({ GODOT_MCP_PROJECT_PATH: " " }, CWD), " ", "only the empty string counts as unset");

console.log("projectPath: all tests passed");
