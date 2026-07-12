/**
 * Section 42 — Debugger tools
 *
 * Tests debug.state, debug.list_breakpoints, debug.set_breakpoint,
 * debug.continue via the bridge. debug.set_breakpoint forks on the editor's
 * script-editor mode, and BOTH branches are asserted deterministically so the
 * section is green under either config: with the built-in editor the set/list/
 * clear cycle exercises the identity-bind contract for real (the echoed file_path
 * is the path the breakpoint actually landed on, verified via is_line_breakpointed;
 * a second script echoes its own path; a missing file errors NOT_FOUND rather than
 * lying); with an external editor active the tool returns EXTERNAL_EDITOR_ACTIVE
 * with a hint steering the user back to the built-in editor.
 */
import { debugTools } from "../../src/tools/debug.js";

import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, assertGuard } from "../helpers.js";

export const TOOLS_TESTED: string[] = [
  "debug_state",
  "debug_set_breakpoint",
  "debug_list_breakpoints",
  "debug_continue",
];
export async function testDebugger(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  // ── Static checks (always run) ──

  // Tool count.
  if (debugTools.length !== 4) {
    fail(`debugger: expected 4 tools, got ${debugTools.length}`);
  } else {
    pass("debugger: 4 tools defined");
  }

  // Description length (I2: <= 200 chars).
  for (const tool of debugTools) {
    if (tool.description.length > 200) {
      fail(`debugger ${tool.name} description ${tool.description.length} > 200 chars`);
    }
  }
  pass(`debugger: all ${debugTools.length} tool descriptions <= 200 chars`);

  // Read-only annotations for state/list tools.
  const readOnlyTools = ["debug_state", "debug_list_breakpoints"];
  for (const name of readOnlyTools) {
    const tool = debugTools.find((t) => t.name === name);
    if (tool && !tool.annotations?.readOnlyHint) {
      fail(`debugger ${name} missing readOnlyHint=true`);
    }
  }
  pass("debugger: read-only tools have readOnlyHint=true");

  // Mutating annotations for set_breakpoint/continue.
  const mutatingTools = ["debug_set_breakpoint", "debug_continue"];
  for (const name of mutatingTools) {
    const tool = debugTools.find((t) => t.name === name);
    if (tool && tool.annotations?.readOnlyHint !== false) {
      fail(`debugger ${name} should have readOnlyHint=false`);
    }
  }
  pass("debugger: mutating tools have readOnlyHint=false");

  // ── Live bridge tests ──

  // 1. debug.state — no game running → active:false.
  const stateResult = (await bridge.call("debug.state", {}, CALL_TIMEOUT)) as {
    success?: boolean;
    active?: boolean;
    breaked?: boolean;
    can_debug?: boolean;
  };
  if (stateResult?.success !== true) {
    fail(`debug.state: expected success, got ${JSON.stringify(stateResult)}`);
  } else if (stateResult.active !== false) {
    // Active could be true if a game is running — not a failure, just note it.
    pass(`debug.state: active=${stateResult.active} breaked=${stateResult.breaked} (game may be running)`);
  } else {
    pass("debug.state: active=false (no game running)");
  }

  // 2. debug.set_breakpoint — behavior forks on the editor's script-editor mode,
  // so assert BOTH branches deterministically (the section is green under either
  // config). A built-in script editor binds the breakpoint on its CodeEdit; an
  // external editor (Editor Settings → Text Editor → External) can't, so the tool
  // returns EXTERNAL_EDITOR_ACTIVE up front. Probe with an always-present dogfood
  // script — this fork is decided by editor config, not by the file — then dispatch
  // to the matching branch's assertions.
  const testFile = "res://Validations/fixtures/env_probe.gd";
  const setResult = (await bridge.call(
    "debug.set_breakpoint",
    { file_path: testFile, line: 1, enabled: true },
    CALL_TIMEOUT,
  )) as {
    success?: boolean;
    file_path?: string;
    line?: number;
    enabled?: boolean;
    code?: string;
    hint?: string;
  };
  if (setResult?.code === "EXTERNAL_EDITOR_ACTIVE") {
    // External-editor branch: a clear refusal with a hint that steers the caller to
    // switch back to the built-in editor. Assert the coded failure + a non-empty hint.
    if (setResult.success === false && typeof setResult.hint === "string" && setResult.hint.length > 0) {
      pass("debug.set_breakpoint: EXTERNAL_EDITOR_ACTIVE with a steering hint (external editor active)");
    } else {
      fail(
        `debug.set_breakpoint(external editor): expected {success:false, hint:string}, got ${JSON.stringify(setResult)}`,
      );
    }
  } else if (setResult?.success === true) {
    // Built-in-editor branch: the full identity-bind contract.
    await testBuiltInIdentityBind(ctx, testFile, setResult);
  } else {
    fail(
      `debug.set_breakpoint: expected success or EXTERNAL_EDITOR_ACTIVE on ${testFile}, got ${JSON.stringify(setResult)}`,
    );
  }

  // Guards: .cs rejection. The .cs type check precedes the external-editor detection
  // in the handler, so this is editor-config-independent (runs under either branch).
  const csResult = await bridge.call("debug.set_breakpoint", { file_path: "res://script.cs", line: 1 }, CALL_TIMEOUT);
  assertGuard(ctx, "debug.set_breakpoint(.cs)", csResult, "UNSUPPORTED_FILE_TYPE", "GDScript");

  // debug.continue error.
  await testContinueError(ctx);
}

/**
 * Built-in-editor identity-bind assertions for debug.set_breakpoint: the echoed
 * file_path is the VERIFIED path the breakpoint landed on (bound by script identity,
 * confirmed via is_line_breakpointed), a second real script echoes ITS own path (not
 * the first's), a missing path errors NOT_FOUND rather than lying, and list/clear
 * round-trip. Only reachable when the first set succeeded (built-in script editor).
 */
async function testBuiltInIdentityBind(
  ctx: TestCtx,
  testFile: string,
  setResult: { file_path?: string; line?: number; enabled?: boolean },
): Promise<void> {
  const { bridge, pass, fail } = ctx;
  const otherFile = "res://scripts/test_framework/check_all_scripts.gd";

  // The echoed file_path equals the request — never an unchecked echo of a misrouted set.
  if (setResult.file_path !== testFile || setResult.line !== 1 || setResult.enabled !== true) {
    fail(`debug.set_breakpoint: unexpected response ${JSON.stringify(setResult)}`);
  } else {
    pass(`debug.set_breakpoint: set breakpoint on ${testFile}:1 (verified path echoed)`);
  }

  // Identity bind: a second call to a DIFFERENT real script must echo THAT script's
  // path — not the first file's. The echo is the path the breakpoint actually landed
  // on, so a phantom/stale current tab can never make it lie.
  const otherSet = (await bridge.call(
    "debug.set_breakpoint",
    { file_path: otherFile, line: 1, enabled: true },
    CALL_TIMEOUT,
  )) as { success?: boolean; file_path?: string; line?: number };
  if (otherSet?.success !== true || otherSet.file_path !== otherFile) {
    fail(`debug.set_breakpoint(identity): expected echoed file_path=${otherFile}, got ${JSON.stringify(otherSet)}`);
  } else {
    pass(`debug.set_breakpoint: second script echoes its own path ${otherFile} (identity bind, not the first file)`);
  }
  // Clear the second breakpoint so only the first remains for the list checks.
  await bridge.call("debug.set_breakpoint", { file_path: otherFile, line: 1, enabled: false }, CALL_TIMEOUT);

  // A non-existent path must ERROR (NOT_FOUND) — never a lying success that echoes a
  // path the breakpoint never bound to.
  const missingSet = (await bridge.call(
    "debug.set_breakpoint",
    { file_path: "res://no_such_script_smoke_42.gd", line: 1, enabled: true },
    CALL_TIMEOUT,
  )) as { success?: boolean; code?: string; file_path?: string };
  if (missingSet?.success === false && missingSet.code === "NOT_FOUND") {
    pass("debug.set_breakpoint(missing file): NOT_FOUND (no lying echo)");
  } else {
    fail(`debug.set_breakpoint(missing file): expected NOT_FOUND, got ${JSON.stringify(missingSet)}`);
  }

  // debug.list_breakpoints — should include the breakpoint we just set.
  const listResult = (await bridge.call("debug.list_breakpoints", {}, CALL_TIMEOUT)) as {
    success?: boolean;
    breakpoints?: { file_path: string; line: number }[];
    count?: number;
  };
  if (listResult?.success !== true) {
    fail(`debug.list_breakpoints: expected success, got ${JSON.stringify(listResult)}`);
  } else {
    const found = listResult.breakpoints?.some((bp) => bp.file_path === testFile && bp.line === 1);
    if (!found) {
      fail(`debug.list_breakpoints: expected ${testFile}:1 in ${JSON.stringify(listResult.breakpoints)}`);
    } else {
      pass(`debug.list_breakpoints: found ${testFile}:1 (${listResult.count} total)`);
    }
  }

  // debug.set_breakpoint — clear the breakpoint.
  const clearResult = (await bridge.call(
    "debug.set_breakpoint",
    { file_path: testFile, line: 1, enabled: false },
    CALL_TIMEOUT,
  )) as { success?: boolean; enabled?: boolean };
  if (clearResult?.success !== true || clearResult.enabled !== false) {
    fail(`debug.set_breakpoint(clear): unexpected ${JSON.stringify(clearResult)}`);
  } else {
    pass(`debug.set_breakpoint: cleared breakpoint on ${testFile}:1`);
  }

  // debug.list_breakpoints — breakpoint should be gone.
  const list2 = (await bridge.call("debug.list_breakpoints", {}, CALL_TIMEOUT)) as {
    success?: boolean;
    breakpoints?: { file_path: string; line: number }[];
  };
  if (list2?.success !== true) {
    fail(`debug.list_breakpoints(after clear): expected success`);
  } else {
    const stillThere = list2.breakpoints?.some((bp) => bp.file_path === testFile && bp.line === 1);
    if (stillThere) {
      fail(`debug.list_breakpoints: ${testFile}:1 still present after clear`);
    } else {
      pass(`debug.list_breakpoints: ${testFile}:1 gone after clear`);
    }
  }
}

async function testContinueError(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  const contResult = (await bridge.call("debug.continue", {}, CALL_TIMEOUT)) as {
    success?: boolean;
    code?: string;
  };
  if (contResult?.success === false && (contResult.code === "GAME_NOT_RUNNING" || contResult.code === "NOT_BREAKED")) {
    pass(`debug.continue: correctly returned ${contResult.code}`);
  } else if (contResult?.success === true) {
    // Game is running and breaked — valid in some test environments.
    pass("debug.continue: game was breaked, resumed successfully");
  } else {
    fail(`debug.continue: unexpected ${JSON.stringify(contResult)}`);
  }
}
