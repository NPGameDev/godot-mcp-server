import assert from "node:assert/strict";
import { compareVersions } from "../../src/version.js";

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
assert.equal(compareVersions("1.0.0", null), "unknown");
assert.equal(compareVersions("1.0.0", undefined), "unknown");
assert.equal(compareVersions("1.0.0", ""), "unknown");

// Unknown — non-semver strings
assert.equal(compareVersions("1.0.0", "abc"), "unknown");
assert.equal(compareVersions("abc", "1.0.0"), "unknown");
assert.equal(compareVersions("1.0.0", "1.0"), "unknown");

console.log("All version tests passed.");
