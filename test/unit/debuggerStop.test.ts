/**
 * Pins `readDebuggerStop` in tools/debuggerStop.ts: how the editor's
 * `debug.state` answer reads as a breakpoint pause, an error break or no stop,
 * including a `can_debug` that is not a boolean, an answer that is not an
 * object and a read that fails.
 */
import assert from "node:assert/strict";
import { readDebuggerStop } from "../../src/tools/debuggerStop.js";
import type { Bridge } from "../../src/shared/types.js";

/** One editor call the fake bridge received. */
interface EditorCall {
  method: string;
  timeoutMs: number | undefined;
}

/** A bridge whose `call` answers with `answer`, recording each call. An `Error` answer is thrown. */
function makeBridge(answer: unknown, calls: EditorCall[] = []): Bridge {
  const fake: Pick<Bridge, "call"> = {
    async call(method: string, _params?: unknown, timeoutMs?: number) {
      calls.push({ method, timeoutMs });
      if (answer instanceof Error) throw answer;
      return structuredClone(answer);
    },
  };
  // The fake keeps only `call`, the one member the reader uses.
  return fake as unknown as Bridge;
}

{
  const stop = await readDebuggerStop(makeBridge({ success: true, breaked: true, can_debug: true }));
  assert.equal(stop, "breakpoint_pause", "breaked true with can_debug true: a breakpoint pause");
}

{
  const calls: EditorCall[] = [];
  await readDebuggerStop(makeBridge({ success: true, breaked: false, can_debug: false }, calls));
  assert.deepEqual(
    calls,
    [{ method: "debug.state", timeoutMs: 5_000 }],
    "the reader asks the editor's debug.state once, bounded at 5 s",
  );
}

{
  const stop = await readDebuggerStop(makeBridge({ success: true, breaked: true, can_debug: false }));
  assert.equal(stop, "error_break", "breaked true with can_debug false: an error break");
}

{
  const stop = await readDebuggerStop(makeBridge({ success: true, breaked: true }));
  assert.equal(stop, "error_break", "breaked true with can_debug missing: an error break");
}

{
  const stop = await readDebuggerStop(makeBridge({ success: true, breaked: true, can_debug: "true" }));
  assert.equal(stop, "error_break", "breaked true with a can_debug that is not a boolean: an error break");
}

{
  const stop = await readDebuggerStop(makeBridge({ success: true, breaked: false, can_debug: true }));
  assert.equal(stop, "none", "breaked false: no stop");
}

{
  assert.equal(await readDebuggerStop(makeBridge("breaked")), "none", "a string answer: no stop");
  assert.equal(await readDebuggerStop(makeBridge(null)), "none", "a null answer: no stop");
}

{
  const stop = await readDebuggerStop(makeBridge(new Error("editor unreachable")));
  assert.equal(stop, "none", "a debug.state read that throws: no stop, and the reader does not reject");
}

console.log("All 8 tests passed.");
