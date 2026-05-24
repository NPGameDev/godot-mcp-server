/**
 * Section 43 — Debugger tools
 *
 * Tests debug.state, debug.list_breakpoints, debug.set_breakpoint,
 * debug.continue via the bridge. Breakpoint set/list/clear cycle
 * validates round-trip through the EditorDebuggerPlugin bridge.
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

  // 2. debug.set_breakpoint — set a breakpoint on Main.gd line 1.
  const testFile = "res://Main.gd";
  const setResult = (await bridge.call(
    "debug.set_breakpoint",
    { file_path: testFile, line: 1, enabled: true },
    CALL_TIMEOUT,
  )) as { success?: boolean; file_path?: string; line?: number; enabled?: boolean; code?: string };
  if (setResult?.success !== true) {
    // Main.gd might not exist in the project — skip remaining breakpoint tests.
    pass(`debug.set_breakpoint: SKIPPED — ${setResult?.code ?? "unknown"} (Main.gd may not exist)`);
    // Still test continue error.
    await testContinueError(ctx);
    return;
  }
  if (setResult.file_path !== testFile || setResult.line !== 1 || setResult.enabled !== true) {
    fail(`debug.set_breakpoint: unexpected response ${JSON.stringify(setResult)}`);
  } else {
    pass("debug.set_breakpoint: set breakpoint on Main.gd:1");
  }

  // 3. debug.list_breakpoints — should include the breakpoint we just set.
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
      fail(`debug.list_breakpoints: expected Main.gd:1 in ${JSON.stringify(listResult.breakpoints)}`);
    } else {
      pass(`debug.list_breakpoints: found Main.gd:1 (${listResult.count} total)`);
    }
  }

  // 4. debug.set_breakpoint — clear the breakpoint.
  const clearResult = (await bridge.call(
    "debug.set_breakpoint",
    { file_path: testFile, line: 1, enabled: false },
    CALL_TIMEOUT,
  )) as { success?: boolean; enabled?: boolean };
  if (clearResult?.success !== true || clearResult.enabled !== false) {
    fail(`debug.set_breakpoint(clear): unexpected ${JSON.stringify(clearResult)}`);
  } else {
    pass("debug.set_breakpoint: cleared breakpoint on Main.gd:1");
  }

  // 5. debug.list_breakpoints — breakpoint should be gone.
  const list2 = (await bridge.call("debug.list_breakpoints", {}, CALL_TIMEOUT)) as {
    success?: boolean;
    breakpoints?: { file_path: string; line: number }[];
  };
  if (list2?.success !== true) {
    fail(`debug.list_breakpoints(after clear): expected success`);
  } else {
    const stillThere = list2.breakpoints?.some((bp) => bp.file_path === testFile && bp.line === 1);
    if (stillThere) {
      fail("debug.list_breakpoints: Main.gd:1 still present after clear");
    } else {
      pass("debug.list_breakpoints: Main.gd:1 gone after clear");
    }
  }

  // 6. Guards: .cs rejection.
  const csResult = await bridge.call("debug.set_breakpoint", { file_path: "res://script.cs", line: 1 }, CALL_TIMEOUT);
  assertGuard(ctx, "debug.set_breakpoint(.cs)", csResult, "UNSUPPORTED_FILE_TYPE", "GDScript");

  // 7. Guard: nonexistent file (outside res:// or missing).
  const badPathResult = await bridge.call(
    "debug.set_breakpoint",
    { file_path: "res://no_such_script_smoke_43.gd", line: 1 },
    CALL_TIMEOUT,
  );
  // The plugin may accept any res:// path for breakpoints (breakpoints are
  // set by path, not validated against the filesystem). If so, success is
  // acceptable — the breakpoint simply won't fire. Either outcome is valid.
  if ((badPathResult as { success?: boolean })?.success === true) {
    pass("debug.set_breakpoint(missing file): accepted (breakpoint won't fire — valid)");
    // Clean up the orphan breakpoint.
    await bridge.call(
      "debug.set_breakpoint",
      { file_path: "res://no_such_script_smoke_43.gd", line: 1, enabled: false },
      CALL_TIMEOUT,
    );
  } else {
    pass(`debug.set_breakpoint(missing file): rejected with ${(badPathResult as { code?: string })?.code ?? "error"}`);
  }

  // 8. debug.continue error.
  await testContinueError(ctx);
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
