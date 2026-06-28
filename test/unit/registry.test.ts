/**
 * Unit tests for registry.ts — core registry I/O.
 *  - normalizePath: slash/trailing/case transforms (platform-aware).
 *  - The public read surface (lookupProject, discoverRuntime) exercised against
 *    a hermetic temp projects.json via the APPDATA / XDG_DATA_HOME env redirect
 *    registryPath() honors. These cases also cover the private readRegistry
 *    (single parse attempt → graceful empty) through that public surface. darwin has no path
 *    override, so the file-writing blocks run only on win32/linux.
 *
 * LSP-discovery (liveLspClaimants / discoverLspEndpoint, plus isPidAlive's own
 * coverage) lives in discoverLsp.test.ts — that file owns the LSP feature.
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { snapshotEnv } from "./helpers.js";
import { normalizePath, registryPath, lookupProject, discoverRuntime, type RegistryEntry } from "../../src/registry.js";

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

// ── Hermetic read-surface tests ──────────────────────────────────────
//
// registryPath() resolves under a temp dir once APPDATA (win32) /
// XDG_DATA_HOME (linux) points there. darwin hardcodes ~/Library and has no
// override, so guard every file-writing block — darwin runs normalizePath only.

const REDIRECT: string | null =
  process.platform === "win32" ? "APPDATA" : process.platform === "linux" ? "XDG_DATA_HOME" : null;

// This process is always alive — used as the default entry pid.
const ALIVE = process.pid;
// Never a live PID → process.kill(DEAD, 0) throws ESRCH on Linux, macOS and
// Windows. Same value/convention as discoverLsp.test.ts (dead-PID filtering).
const DEAD = 2147483646;

/** Build a complete RegistryEntry, overriding only what a case cares about. */
function makeEntry(over: Partial<RegistryEntry>): RegistryEntry {
  return {
    port: 6550,
    token_path: "tok",
    pid: ALIVE,
    started_at: 1000,
    runtime_port: null,
    runtime_pid: null,
    ...over,
  };
}

/**
 * Write a hermetic projects.json under a fresh temp dir, run fn, then restore
 * env + delete the temp dir. No-op on darwin (no path override).
 */
function withRegistry(byPath: Record<string, RegistryEntry>, fn: () => void): void {
  if (!REDIRECT) return;
  const restoreEnv = snapshotEnv();
  const tmpRoot = mkdtempSync(join(tmpdir(), "godot-mcp-reg-"));
  try {
    process.env[REDIRECT] = tmpRoot;
    mkdirSync(dirname(registryPath()), { recursive: true });
    writeFileSync(registryPath(), JSON.stringify({ by_path: byPath }));
    fn();
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
    restoreEnv();
  }
}

/** Write raw file contents (for malformed/wrong-shape cases), run fn, restore. */
function withRawRegistry(raw: string | null, fn: () => void): void {
  if (!REDIRECT) return;
  const restoreEnv = snapshotEnv();
  const tmpRoot = mkdtempSync(join(tmpdir(), "godot-mcp-reg-"));
  try {
    process.env[REDIRECT] = tmpRoot;
    mkdirSync(dirname(registryPath()), { recursive: true });
    if (raw !== null) writeFileSync(registryPath(), raw);
    fn();
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
    restoreEnv();
  }
}

// ── lookupProject: normalization on both write key and lookup arg ─────

{
  const canonical = normalizePath("C:/Games/MyProj");
  withRegistry({ [canonical]: makeEntry({}) }, () => {
    // Forward-slash form resolves.
    assert.ok(lookupProject("C:/Games/MyProj"), "lookupProject: canonical path resolves");
    // Backslash form resolves.
    assert.ok(lookupProject("C:\\Games\\MyProj"), "lookupProject: backslash form resolves");
    // Trailing slash resolves.
    assert.ok(lookupProject("C:/Games/MyProj/"), "lookupProject: trailing slash resolves");
    // Case-insensitive platforms also match a different-case spelling.
    if (process.platform === "win32") {
      assert.ok(lookupProject("c:/games/myproj"), "lookupProject: case-insensitive match");
    }
    // Unknown path → null.
    assert.equal(lookupProject("/no/such/path"), null, "lookupProject: missing → null");
  });
}

// ── discoverRuntime: valid port, null, out-of-range, missing ─────────

{
  const key = normalizePath("/proj/run");
  withRegistry({ [key]: makeEntry({ runtime_port: 6570 }) }, () => {
    assert.equal(discoverRuntime("/proj/run"), 6570, "discoverRuntime: in-range port returned");
  });
  withRegistry({ [key]: makeEntry({ runtime_port: null }) }, () => {
    assert.equal(discoverRuntime("/proj/run"), null, "discoverRuntime: null port → null");
  });
  withRegistry({ [key]: makeEntry({ runtime_port: 80 }) }, () => {
    assert.equal(discoverRuntime("/proj/run"), null, "discoverRuntime: below 1024 → null");
  });
  withRegistry({ [key]: makeEntry({ runtime_port: 70000 }) }, () => {
    assert.equal(discoverRuntime("/proj/run"), null, "discoverRuntime: above 65535 → null");
  });
  withRegistry({}, () => {
    assert.equal(discoverRuntime("/proj/run"), null, "discoverRuntime: missing project → null");
  });
}

// ── 073: discoverRuntime runtime_pid liveness gate ───────────────────
//
// Symmetric with liveLspClaimants' dead-PID filter: a crashed playtest leaves
// runtime_port set (the toolkit has no PID-based GC), so discoverRuntime must
// skip a port whose owning process is provably dead — otherwise the bridge
// attempts a doomed connect. A null runtime_pid (no owner) does NOT block; that
// path is already covered above (makeEntry defaults runtime_pid to null and the
// in-range case returns the port).
{
  const key = normalizePath("/proj/run");
  // Valid port but a dead owner → gate fires → null.
  withRegistry({ [key]: makeEntry({ runtime_port: 6570, runtime_pid: DEAD }) }, () => {
    assert.equal(discoverRuntime("/proj/run"), null, "discoverRuntime: dead runtime_pid → null");
  });
  // Valid port + a live owner → gate must not over-block → port returned.
  withRegistry({ [key]: makeEntry({ runtime_port: 6570, runtime_pid: ALIVE }) }, () => {
    assert.equal(discoverRuntime("/proj/run"), 6570, "discoverRuntime: live runtime_pid → port returned");
  });
}

// ── readRegistry: malformed / wrong-shape / missing → graceful empty ──

{
  // Malformed JSON → graceful empty (single parse attempt; concern 072 dropped the retry/busy-wait).
  withRawRegistry("{ partial", () => {
    assert.equal(lookupProject("/anything"), null, "readRegistry: malformed JSON → null");
  });
  // Valid JSON but no by_path → treated as empty.
  withRawRegistry('{"foo":1}', () => {
    assert.equal(lookupProject("/anything"), null, "readRegistry: wrong shape → null");
  });
  // File absent entirely → empty.
  withRawRegistry(null, () => {
    assert.equal(lookupProject("/anything"), null, "readRegistry: missing file → null");
  });
}

// ── 072: malformed registry degrades immediately (no retry / busy-wait) ──
//
// readRegistry once retried a parse failure 3× with a synchronous busy-wait
// (~300ms total), freezing Node's only thread. The toolkit writes atomically
// (.tmp → rename), so a parse failure is genuine corruption that re-reading the
// same bytes cannot fix — the retry was dropped (concern 072). A malformed file
// must degrade through a public reader to empty: graceful (no throw) and fast
// (no spin). Exercises discoverRuntime (the second public reader path).
{
  withRawRegistry("{ not valid json", () => {
    const start = Date.now();
    let result: number | null = 0;
    // Primary guarantee: graceful degradation, no exception escapes.
    assert.doesNotThrow(() => {
      result = discoverRuntime("/proj/run");
    }, "072: malformed JSON degrades without throwing");
    assert.equal(result, null, "072: malformed JSON → discoverRuntime null");
    // Secondary: the dropped busy-wait spun ~300ms; a single parse attempt is
    // sub-millisecond. Generous bound keeps CI non-flaky while still excluding
    // the old spin (the structural removal of the loop is the real guarantee).
    assert.ok(Date.now() - start < 200, "072: no busy-wait — returns well under the old ~300ms");
  });
}

console.log("All registry tests passed.");
