import assert from "node:assert/strict";
import {
  compareVersions,
  parseGodotVer,
  compareGodotVer,
  isVersionCompatible,
  isVersionAtLeast,
  isVersionAtMost,
} from "../../src/version.js";

// ── compareVersions tests ───────────────────────────────────────────

// Exact match
assert.equal(compareVersions("1.0.0", "1.0.0"), "ok");
assert.equal(compareVersions("2.3.4", "2.3.4"), "ok");
assert.equal(compareVersions("0.0.0", "0.0.0"), "ok");

// Minor mismatch (same major, different minor)
assert.equal(compareVersions("1.0.0", "1.1.0"), "minor");
assert.equal(compareVersions("1.2.0", "1.0.0"), "minor");
assert.equal(compareVersions("2.0.0", "2.5.3"), "minor");

// Patch mismatch (same major+minor, different patch)
assert.equal(compareVersions("1.0.0", "1.0.1"), "minor");
assert.equal(compareVersions("1.0.5", "1.0.0"), "minor");

// Major mismatch
assert.equal(compareVersions("1.0.0", "2.0.0"), "major");
assert.equal(compareVersions("2.0.0", "1.0.0"), "major");
assert.equal(compareVersions("1.5.3", "3.0.0"), "major");

// Unknown — null, undefined, empty
assert.equal(compareVersions("1.0.0", undefined), "unknown");
assert.equal(compareVersions("1.0.0", undefined), "unknown");
assert.equal(compareVersions("1.0.0", ""), "unknown");

// Unknown — non-semver strings
assert.equal(compareVersions("1.0.0", "abc"), "unknown");
assert.equal(compareVersions("abc", "1.0.0"), "unknown");
assert.equal(compareVersions("1.0.0", "1.0"), "unknown");

// ── parseGodotVer tests ────────────────────────────────────────────

assert.deepEqual(parseGodotVer("4.5"), [4, 5]);
assert.deepEqual(parseGodotVer("4.5.1"), [4, 5]); // patch discarded
assert.deepEqual(parseGodotVer("5.0"), [5, 0]);

// ── compareGodotVer tests ──────────────────────────────────────────

assert.equal(compareGodotVer([4, 5], [4, 5]), 0);
assert.ok(compareGodotVer([4, 4], [4, 5]) < 0);
assert.ok(compareGodotVer([5, 0], [4, 6]) > 0);

// ── isVersionCompatible tests ──────────────────────────────────────

// min only
assert.equal(isVersionCompatible([4, 4], "4.5", undefined), false);
assert.equal(isVersionCompatible([4, 5], "4.5", undefined), true);
assert.equal(isVersionCompatible([4, 6], "4.5", undefined), true);

// max only
assert.equal(isVersionCompatible([4, 5], undefined, "4.4"), false);
assert.equal(isVersionCompatible([4, 4], undefined, "4.4"), true);
assert.equal(isVersionCompatible([4, 3], undefined, "4.4"), true);

// both min and max
assert.equal(isVersionCompatible([4, 3], "4.2", "4.4"), true);
assert.equal(isVersionCompatible([4, 5], "4.2", "4.4"), false);
assert.equal(isVersionCompatible([4, 1], "4.2", "4.4"), false);
assert.equal(isVersionCompatible([4, 2], "4.2", "4.4"), true);
assert.equal(isVersionCompatible([4, 4], "4.2", "4.4"), true);

// no bounds
assert.equal(isVersionCompatible([4, 5], undefined, undefined), true);
assert.equal(isVersionCompatible([3, 0], undefined, undefined), true);

// ── Godot 5.x compatibility ──────────────────────────────────────────

// 5.x satisfies a 4.x minimum (5.0 >= 4.5)
assert.equal(isVersionCompatible([5, 0], "4.5", undefined), true);
assert.equal(isVersionCompatible([5, 2], "4.2", undefined), true);

// 5.x exceeds a 4.x maximum (5.0 > 4.4)
assert.equal(isVersionCompatible([5, 0], undefined, "4.4"), false);
assert.equal(isVersionCompatible([5, 1], undefined, "4.6"), false);

// 5.x within 5.x range
assert.equal(isVersionCompatible([5, 0], "5.0", undefined), true);
assert.equal(isVersionCompatible([5, 0], "5.1", undefined), false);
assert.equal(isVersionCompatible([5, 2], "5.0", "5.3"), true);
assert.equal(isVersionCompatible([5, 2], "5.0", "5.1"), false);

// 5.x against a 4.x range (above max)
assert.equal(isVersionCompatible([5, 0], "4.2", "4.4"), false);
assert.equal(isVersionCompatible([5, 1], "4.2", "4.6"), false);

// ── isVersionAtLeast tests ───────────────────────────────────────────

assert.equal(isVersionAtLeast([4, 5], "4.5"), true);
assert.equal(isVersionAtLeast([4, 6], "4.5"), true);
assert.equal(isVersionAtLeast([4, 4], "4.5"), false);
assert.equal(isVersionAtLeast([5, 0], "4.5"), true); // 5.x >= 4.x
assert.equal(isVersionAtLeast([5, 0], "5.1"), false);

// ── isVersionAtMost tests ────────────────────────────────────────────

assert.equal(isVersionAtMost([4, 4], "4.4"), true);
assert.equal(isVersionAtMost([4, 3], "4.4"), true);
assert.equal(isVersionAtMost([4, 5], "4.4"), false);
assert.equal(isVersionAtMost([5, 0], "4.6"), false); // 5.x > 4.x
assert.equal(isVersionAtMost([5, 0], "5.0"), true);

console.log("All version tests passed.");
