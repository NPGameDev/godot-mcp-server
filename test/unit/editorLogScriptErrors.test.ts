/**
 * Unit tests for scripts/ci/editor-log-script-errors.mjs, the cross-version smoke step that
 * fails a job on a GDScript error raised in the toolkit addon. Drives findOffendingBlocks
 * and checkLogs on log excerpts from real smoke jobs (test/fixtures/editor-logs/) and on
 * synthetic blocks in each engine line shape, and the CLI's exit codes through a child process.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkLogs, findOffendingBlocks } from "../../scripts/ci/editor-log-script-errors.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(here, "../../scripts/ci/editor-log-script-errors.mjs");

function excerpt(name: string): string {
  return readFileSync(join(here, "../fixtures/editor-logs", name), "utf8");
}

const UNFOCUSED_SLEEP_FILE = "res://addons/godot_mcp_toolkit/core/unfocused_sleep_controller.gd";

// ── Fixture blocks pass ──────────────────────────────────────────────

{
  assert.deepEqual(
    findOffendingBlocks(excerpt("linux-4.2.0-fixtures.txt")),
    [],
    "4.2 fixture blocks (txtflt hit/miss, check broken/hint, LSP project scan, in-memory gdscript://) pass",
  );
}

{
  assert.deepEqual(
    findOffendingBlocks(excerpt("linux-4.4.0-probe-fixtures.txt")),
    [],
    "the script_edit probe and flow compile probe fixture blocks pass",
  );
}

{
  assert.deepEqual(
    findOffendingBlocks(excerpt("linux-4.2.0-compile-probe-path.txt")),
    [],
    "compile-probe blocks framed beside the checked file (<file>.__mcp_probe_<id>.gd) pass",
  );
}

{
  assert.deepEqual(
    findOffendingBlocks(excerpt("linux-4.7.0-fixtures.txt")),
    [],
    "4.7 fixture blocks pass although their backtraces run through toolkit frames",
  );
}

{
  const macosFixtureBlocks = [
    '\x1b[1;35mSCRIPT ERROR:\x1b[0;95m Parse Error: Could not find base class "BogusHitClass".',
    "\x1b[0;90m          at: GDScript::reload (res://smoke_txtflt_hit.gd:1)\x1b[0m",
    '\x1b[1;31mERROR:\x1b[0;91m Failed to load script "res://smoke_txtflt_hit.gd" with error "Parse error".',
    "\x1b[0;90m   at: load (modules/gdscript/gdscript.cpp:2775)\x1b[0m",
    '\x1b[1;35mSCRIPT ERROR:\x1b[0;95m Parse Error: Could not find base class "BogusHitClass".',
    "\x1b[0;90m          at: GDScript::reload (gdscript://-9223368882218010051.gd:1)\x1b[0m",
  ].join("\n");
  assert.deepEqual(findOffendingBlocks(macosFixtureBlocks), [], "ANSI-coloured macOS fixture blocks pass");
}

{
  assert.deepEqual(
    findOffendingBlocks(excerpt("windows-4.2.0-mono-split-frame.txt")),
    [],
    "a fixture block whose frame line C# output split takes the frame of the next entry and passes",
  );
}

// ── Toolkit blocks fail ──────────────────────────────────────────────

{
  const offending = findOffendingBlocks(excerpt("linux-4.7.0-unfocused-sleep.txt"));
  assert.equal(offending.length, 1, "the Linux 4.7 unfocused-sleep block fails");
  assert.equal(offending[0].reason, `raised in ${UNFOCUSED_SLEEP_FILE}`, "the failure names the erroring file");
  assert.equal(offending[0].lines.length, 10, "the block prints whole: header, frame and its 8-line backtrace");
  assert.equal(
    offending[0].lines[1],
    `          at: lower (${UNFOCUSED_SLEEP_FILE}:111)`,
    "the printed block carries the erroring frame with its line",
  );
}

{
  const offending = findOffendingBlocks(excerpt("windows-4.7.0-unfocused-sleep.txt"));
  assert.equal(offending.length, 1, "the Windows 4.7 unfocused-sleep block (3-space frame) fails");
  assert.equal(offending[0].reason, `raised in ${UNFOCUSED_SLEEP_FILE}`, "the failure names the erroring file");
}

{
  const macosToolkitBlock = [
    "\x1b[1;35mSCRIPT ERROR:\x1b[0;95m Invalid call. Nonexistent function 'missing' in base 'RefCounted'.",
    "\x1b[0;90m          at: _ready (res://addons/godot_mcp_toolkit/plugin.gd:42)\x1b[0m",
  ].join("\n");
  assert.equal(findOffendingBlocks(macosToolkitBlock).length, 1, "an ANSI-coloured macOS toolkit block fails");
}

{
  const windowsParseError = [
    'SCRIPT ERROR: Parse Error: Identifier "EditorThing" not declared in the current scope.',
    "   at: GDScript::reload (res://addons/godot_mcp_toolkit/core/settings_registration.gd:12)",
  ].join("\r\n");
  assert.equal(
    findOffendingBlocks(windowsParseError).length,
    1,
    "a toolkit parse error in the Windows shape (3-space frame, CRLF) fails",
  );
}

{
  const unixParseError = [
    'SCRIPT ERROR: Parse Error: Identifier "EditorThing" not declared in the current scope.',
    "          at: GDScript::reload (res://addons/godot_mcp_toolkit/core/settings_registration.gd:12)",
  ].join("\n");
  assert.equal(findOffendingBlocks(unixParseError).length, 1, "a toolkit parse error in the Unix shape fails");
}

{
  const windowsRuntimeError = [
    "SCRIPT ERROR: Invalid access to property or key 'port' on a base object of type 'Nil'.",
    "   at: start (res://addons/godot_mcp_toolkit/transport/mcp_server.gd:88)",
  ].join("\r\n");
  assert.equal(
    findOffendingBlocks(windowsRuntimeError).length,
    1,
    "a toolkit runtime error in the Windows shape fails",
  );
}

{
  const unixRuntimeError = [
    "SCRIPT ERROR: Invalid access to property or key 'port' on a base object of type 'Nil'.",
    "          at: start (res://addons/godot_mcp_toolkit/transport/mcp_server.gd:88)",
  ].join("\n");
  assert.equal(findOffendingBlocks(unixRuntimeError).length, 1, "a toolkit runtime error in the Unix shape fails");
}

{
  const userScriptError = [
    "USER SCRIPT ERROR: Assertion failed.",
    "   at: _enter_tree (res://addons/godot_mcp_toolkit/plugin.gd:30)",
  ].join("\n");
  assert.equal(findOffendingBlocks(userScriptError).length, 1, "a USER SCRIPT ERROR in a toolkit file fails");
}

{
  const builtInParseError = [
    'SCRIPT ERROR: Parse Error: Expected end of statement after expression, found "Identifier" instead.',
    "          at: GDScript::reload (built-in:3)",
  ].join("\n");
  const offending = findOffendingBlocks(builtInParseError);
  assert.equal(offending.length, 1, "a parse error in a path-less script (built-in) fails");
  assert.equal(offending[0].reason, "raised in a path-less script (built-in)", "the failure names the path-less frame");
}

{
  const builtInRuntimeError = [
    "SCRIPT ERROR: Invalid call. Nonexistent function 'flush' in base 'Nil'.",
    "          at: _log_message (<built-in>:14)",
  ].join("\n");
  assert.equal(
    findOffendingBlocks(builtInRuntimeError).length,
    1,
    "a runtime error in a path-less script (<built-in>) fails",
  );
}

// ── A block without a frame fails closed ─────────────────────────────

{
  const noFrame = [
    "SCRIPT ERROR: Invalid call. Nonexistent 'int' constructor.",
    "[MCP] MCP client connected (1 peer)",
    'SCRIPT ERROR: Parse Error: Could not find base class "BogusHitClass".',
    "          at: GDScript::reload (res://smoke_txtflt_hit.gd:1)",
  ].join("\n");
  const offending = findOffendingBlocks(noFrame);
  assert.equal(offending.length, 1, "a block that reaches the next header without an at: line fails");
  assert.equal(offending[0].reason, "no `at:` line names the erroring frame", "the failure says the frame is missing");
}

{
  const truncated = "[MCP] MCP client connected (1 peer)\nSCRIPT ERROR: Invalid call. Nonexistent 'int' constructor.\n";
  assert.equal(findOffendingBlocks(truncated).length, 1, "a block cut off at the end of the log fails");
}

// ── checkLogs: which logs are read ───────────────────────────────────

{
  const dir = mkdtempSync(join(tmpdir(), "editor-log-gate-"));
  try {
    const failures = checkLogs(join(dir, "editor.log"));
    assert.equal(failures.length, 1, "a missing editor log fails");
    assert.equal(failures[0].reason, "the log is missing", "the failure says the log is missing");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

{
  const dir = mkdtempSync(join(tmpdir(), "editor-log-gate-"));
  try {
    writeFileSync(join(dir, "editor.log"), "");
    const failures = checkLogs(join(dir, "editor.log"));
    assert.equal(failures.length, 1, "an empty editor log fails");
    assert.equal(failures[0].reason, "the log is empty", "the failure says the log is empty");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

{
  const dir = mkdtempSync(join(tmpdir(), "editor-log-gate-"));
  try {
    writeFileSync(join(dir, "editor.log"), excerpt("linux-4.2.0-fixtures.txt"));
    assert.deepEqual(
      checkLogs(join(dir, "editor.log"), [join(dir, "warmup.log")]),
      [],
      "a missing warm-up log passes when the editor log is clean",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

{
  const dir = mkdtempSync(join(tmpdir(), "editor-log-gate-"));
  try {
    writeFileSync(join(dir, "editor.log"), excerpt("linux-4.2.0-fixtures.txt"));
    writeFileSync(join(dir, "warmup.log"), excerpt("linux-4.7.0-unfocused-sleep.txt"));
    const failures = checkLogs(join(dir, "editor.log"), [join(dir, "warmup.log")]);
    assert.equal(failures.length, 1, "a toolkit block in a present warm-up log fails");
    assert.equal(failures[0].log, join(dir, "warmup.log"), "the failure names the warm-up log");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── The CLI's exit codes ─────────────────────────────────────────────

function runCli(args: string[]): number | null {
  return spawnSync(process.execPath, [scriptPath, ...args], { encoding: "utf8" }).status;
}

{
  const dir = mkdtempSync(join(tmpdir(), "editor-log-gate-"));
  try {
    writeFileSync(join(dir, "editor.log"), excerpt("linux-4.7.0-fixtures.txt"));
    assert.equal(runCli([join(dir, "editor.log"), "--if-present", join(dir, "warmup.log")]), 0, "a clean log exits 0");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

{
  const dir = mkdtempSync(join(tmpdir(), "editor-log-gate-"));
  try {
    writeFileSync(join(dir, "editor.log"), excerpt("linux-4.7.0-unfocused-sleep.txt"));
    assert.equal(runCli([join(dir, "editor.log")]), 1, "a log with a toolkit block exits 1");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

{
  const dir = mkdtempSync(join(tmpdir(), "editor-log-gate-"));
  try {
    assert.equal(runCli([join(dir, "editor.log")]), 1, "a missing editor log exits 1");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

{
  assert.equal(runCli([]), 2, "no log argument exits 2");
}

{
  assert.equal(runCli(["editor.log", "--if-present"]), 2, "--if-present without a path exits 2");
}

console.log("All 26 tests passed.");
