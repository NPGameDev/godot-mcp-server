import assert from "node:assert/strict";
import {
  checkPath,
  checkPathGuard,
  guardPrefixes,
  PROJECT_FILE_PATH,
  PATH_FIXTURE,
} from "../../src/security/pathGuard.js";
import { ALL_TOOL_DEFS } from "../../src/registration/catalogue.js";

// ── guardPrefixes ───────────────────────────────────────────────────

assert.deepEqual(guardPrefixes({ param: "file_path", guard: "project" }), ["res://"]);
assert.deepEqual(guardPrefixes({ param: "path", guard: "user" }), ["user://"]);
assert.deepEqual(guardPrefixes({ param: "save_path", prefixes: ["res://", "user://screenshots/"] }), [
  "res://",
  "user://screenshots/",
]);
assert.deepEqual(PROJECT_FILE_PATH, { param: "file_path", guard: "project" });

// ── checkPath MUST ALLOW (no false rejections) ──────────────────────
// A false rejection here silently breaks a valid tool call — the worst
// failure mode for a defense-in-depth filter.

const allow: [string, string[]][] = [
  ["res://x.gd", ["res://"]],
  ["res://a/b/c.tscn", ["res://"]],
  ["res://addons/foo/bar.gd", ["res://"]],
  // dots that are NOT an exact `..` segment — the classic over-block bug.
  ["res://my..thing/x.gd", ["res://"]],
  ["res://a.b.c/d.gd", ["res://"]],
  ["res://..a/x.gd", ["res://"]],
  ["res://a../x.gd", ["res://"]],
  // trailing-slash dirs
  ["res://a/b/", ["res://"]],
  // user-data guard
  ["user://saves/x.json", ["user://"]],
  // multi-prefix outlier (editor_screenshot.save_path)
  ["user://screenshots/shot.png", ["res://", "user://screenshots/"]],
  ["res://shot.png", ["res://", "user://screenshots/"]],
];
for (const [p, prefixes] of allow) {
  assert.equal(checkPath(p, prefixes).ok, true, `should ALLOW ${p} for [${prefixes}]`);
}

// ── checkPath MUST DENY (no escapes) ────────────────────────────────

const deny: [string, string[]][] = [
  ["res://../escape.gd", ["res://"]],
  ["res://a/../../../escape", ["res://"]],
  ["../../etc/passwd", ["res://"]],
  ["..", ["res://"]],
  ["res://a/../b", ["res://"]],
  ["/etc/passwd", ["res://"]],
  ["C:/Windows/x", ["res://"]],
  ["c:\\Windows\\x", ["res://"]],
  ["\\\\server\\share\\x", ["res://"]], // UNC → //server/share after normalize
  ["random/x.gd", ["res://"]], // non-allowed prefix
  ["file:///etc/passwd", ["res://"]],
  ["user://x.json", ["res://"]], // wrong prefix for a project tool
  ["res://x.gd", ["user://"]], // wrong prefix for a user tool
  ["user://other/x.png", ["res://", "user://screenshots/"]], // user:// but not screenshots/
  ["", ["res://"]], // empty
  ["   ", ["res://"]], // whitespace-only
];
for (const [p, prefixes] of deny) {
  assert.equal(checkPath(p, prefixes).ok, false, `should DENY ${p} for [${prefixes}]`);
}

// ── checkPathGuard — dispatch policy (skip absent/empty, validate arrays) ──

// Absent / empty / whitespace defer to the toolkit (an unprovided optional
// param = save-in-place / detach, NOT a rejection).
assert.equal(checkPathGuard(PROJECT_FILE_PATH, undefined).ok, true);
assert.equal(checkPathGuard(PROJECT_FILE_PATH, null).ok, true);
assert.equal(checkPathGuard(PROJECT_FILE_PATH, "").ok, true);
assert.equal(checkPathGuard(PROJECT_FILE_PATH, "   ").ok, true);
assert.equal(checkPathGuard(PROJECT_FILE_PATH, 42).ok, true); // non-string → skip

// Present + valid / invalid
assert.equal(checkPathGuard(PROJECT_FILE_PATH, "res://ok.gd").ok, true);
assert.equal(checkPathGuard(PROJECT_FILE_PATH, "res://../escape.gd").ok, false);
assert.equal(checkPathGuard({ param: "path", guard: "user" }, "user://save.json").ok, true);
assert.equal(checkPathGuard({ param: "path", guard: "user" }, "res://nope.gd").ok, false);

// Array param (editor_refresh.file_paths-style) — every element validated.
assert.equal(checkPathGuard(PROJECT_FILE_PATH, ["res://a.gd", "res://b.gd"]).ok, true);
assert.equal(checkPathGuard(PROJECT_FILE_PATH, ["res://a.gd", "res://../escape"]).ok, false);
assert.equal(checkPathGuard(PROJECT_FILE_PATH, ["res://a.gd", "", "res://b.gd"]).ok, true); // empty element skipped

// ── Shared subset fixture (mirrored in toolkit test/run_unit_tests.gd) ──
// Enforces the cross-repo invariant: NO path is server-deny / toolkit-allow.
// The server asserts its own verdict here; the GDScript mirror asserts
// FileGuard against the SAME paths. Divergence fails one suite.

for (const [p, prefixes] of PATH_FIXTURE.allow) {
  assert.equal(checkPath(p, prefixes as string[]).ok, true, `fixture ALLOW failed: ${p}`);
}
for (const [p, prefixes] of PATH_FIXTURE.deny) {
  assert.equal(checkPath(p, prefixes as string[]).ok, false, `fixture DENY failed: ${p}`);
}

// ── Declaration invariants over the real catalogue ─────────────────
// Shields the per-ToolDef declarations from drift: a future edit can't
// silently guard a scene-tree path, guard the absolute-allowed source_path,
// or drop a key guard, without failing here.

const NODE_TREE_PARAMS = new Set(["node_path", "parent_path", "sprite_path", "track_path", "player_path", "to"]);
const byName = new Map(ALL_TOOL_DEFS.map((t) => [t.name, t]));
const pp = (name: string) => byName.get(name)?.pathParams ?? [];

for (const tool of ALL_TOOL_DEFS) {
  for (const g of tool.pathParams ?? []) {
    assert.ok(!NODE_TREE_PARAMS.has(g.param), `${tool.name} must NOT guard scene-tree param '${g.param}'`);
    assert.notEqual(g.param, "source_path", `${tool.name} must NOT guard absolute-allowed source_path`);
    assert.notEqual(g.param, "texture_path", `${tool.name} must NOT guard res://-scoped texture_path`);
    assert.ok(guardPrefixes(g).length > 0, `${tool.name}.${g.param} resolves to no prefixes`);
  }
}

// Spot-checks of key declarations.
assert.deepEqual(pp("file_delete"), [{ param: "file_path", guard: "project" }]);
assert.deepEqual(pp("save_write"), [{ param: "path", guard: "user" }]);
assert.deepEqual(pp("node_set_script"), [{ param: "script_path", guard: "project" }]);
assert.deepEqual(pp("scene_instantiate"), [{ param: "scene_path", guard: "project" }]);
// asset_import guards dest_path only (source_path is absolute-allowed).
{
  const ai = pp("asset_import");
  assert.equal(ai.length, 1);
  assert.equal(ai[0].param, "dest_path");
}
// editor_screenshot save_path allows res:// + user://screenshots/.
{
  const es = pp("editor_screenshot");
  assert.equal(es.length, 1);
  assert.deepEqual(guardPrefixes(es[0]), ["res://", "user://screenshots/"]);
}
// No guard where it would false-reject: sentinel scene_path, node-tree-only tools.
assert.deepEqual(pp("game_start"), []); // scene_path = 'main'|'current'|res://
assert.deepEqual(pp("scene_create_node"), []); // parent_path is a node path
assert.deepEqual(pp("scene_delete_node"), []); // node_path is a node path
// Every tileset tool guards file_path (the .map injection on both sub-arrays).
assert.deepEqual(pp("tileset_create"), [{ param: "file_path", guard: "project" }]);
assert.deepEqual(pp("tileset_edit_physics"), [{ param: "file_path", guard: "project" }]);

console.log("All path_guard tests passed.");
