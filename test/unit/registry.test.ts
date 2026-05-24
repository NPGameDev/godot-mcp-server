/**
 * Unit tests for registry.ts — normalizePath with platform mocking.
 * Tests both Windows and Unix inputs as hardcoded strings.
 */
import assert from "node:assert/strict";
import { normalizePath } from "../../src/registry.js";

// ── normalizePath tests ──────────────────────────────────────────────

// The current platform determines case behavior. We test the transform
// logic (slashes, trailing) on all platforms, and case behavior based
// on what the current OS does.

const isCaseInsensitive = process.platform === "win32" || process.platform === "darwin";

// Backslashes → forward slashes
{
  const result = normalizePath("C:\\Users\\nicol\\Projects\\MyGame");
  if (isCaseInsensitive) {
    assert.equal(result, "c:/users/nicol/projects/mygame");
  } else {
    assert.equal(result, "C:/Users/nicol/Projects/MyGame");
  }
}

// Trailing slashes stripped
{
  const result = normalizePath("/home/user/projects/mygame/");
  if (isCaseInsensitive) {
    assert.equal(result, "/home/user/projects/mygame");
  } else {
    assert.equal(result, "/home/user/projects/mygame");
  }
}

// Multiple trailing slashes
{
  const result = normalizePath("/home/user///");
  if (isCaseInsensitive) {
    assert.equal(result, "/home/user");
  } else {
    assert.equal(result, "/home/user");
  }
}

// Spaces in paths (Windows-style)
{
  const result = normalizePath("C:\\Users\\My User\\Godot Projects\\RPG Demo");
  if (isCaseInsensitive) {
    assert.equal(result, "c:/users/my user/godot projects/rpg demo");
  } else {
    assert.equal(result, "C:/Users/My User/Godot Projects/RPG Demo");
  }
}

// Mixed slashes
{
  const result = normalizePath("C:\\Users/nicol\\Projects/Game");
  if (isCaseInsensitive) {
    assert.equal(result, "c:/users/nicol/projects/game");
  } else {
    assert.equal(result, "C:/Users/nicol/Projects/Game");
  }
}

// Drive letters (Windows)
{
  const result = normalizePath("D:\\Games\\Godot");
  if (isCaseInsensitive) {
    assert.equal(result, "d:/games/godot");
  } else {
    assert.equal(result, "D:/Games/Godot");
  }
}

// Unix paths stay as-is (no backslashes to convert)
{
  const result = normalizePath("/home/user/projects/mygame");
  if (isCaseInsensitive) {
    assert.equal(result, "/home/user/projects/mygame");
  } else {
    assert.equal(result, "/home/user/projects/mygame");
  }
}

// Already-normalized path is idempotent
{
  const input = isCaseInsensitive ? "c:/users/nicol/projects" : "/home/user/projects";
  assert.equal(normalizePath(input), input);
  // Double-normalize
  assert.equal(normalizePath(normalizePath(input)), input);
}

// Empty trailing slash edge case — root path
{
  const result = normalizePath("C:\\");
  if (isCaseInsensitive) {
    assert.equal(result, "c:");
  } else {
    assert.equal(result, "C:");
  }
}

// Consecutive separators in the middle — preserved (only trailing stripped)
{
  const result = normalizePath("C:\\Users\\\\nicol\\\\Projects");
  if (isCaseInsensitive) {
    assert.equal(result, "c:/users//nicol//projects");
  } else {
    assert.equal(result, "C:/Users//nicol//Projects");
  }
}

// Case sensitivity on current platform
if (isCaseInsensitive) {
  // Same path, different case → should normalize identically
  assert.equal(normalizePath("C:\\Users\\NICOL"), normalizePath("C:\\Users\\nicol"));
  assert.equal(normalizePath("/Home/User"), normalizePath("/home/user"));
} else {
  // Case-sensitive: different case → different results
  assert.notEqual(normalizePath("/Home/User"), normalizePath("/home/user"));
}

console.log("All registry tests passed.");
