/**
 * Unit tests for scripts/ci/editor-clean-stop.mjs, the bridge calls of the cross-version
 * composite's editor stop. Drives the sentinel's execute.code bodies and the sentinel verdict
 * line, which decides whether the editor-log check warns (editor unreachable) or fails (editor
 * refused the sentinel).
 */
import assert from "node:assert/strict";
import { sentinelCalls, sentinelVerdict } from "../../scripts/ci/editor-clean-stop.mjs";

function bridgeError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

{
  assert.deepEqual(
    sentinelCalls("MCP_STOP_SENTINEL_unit"),
    ['printerr("MCP_STOP_SENTINEL_unit")', 'printerr("MCP_STOP_SENTINEL_unit")'],
    "the sentinel is printed twice, so a write split inside one copy leaves the other intact",
  );
}

{
  assert.equal(sentinelVerdict(2, undefined), "sentinel=sent (2 of 2 copies)", "both copies taken: sent");
}

{
  assert.equal(
    sentinelVerdict(1, bridgeError("RPC_ERROR", "-32000: busy")),
    "sentinel=sent (1 of 2 copies)",
    "one copy taken before an error: sent, so the check still requires it",
  );
}

{
  for (const code of ["CONNECT_FAILED", "DISCONNECTED", "TIMEOUT"]) {
    assert.equal(
      sentinelVerdict(0, bridgeError(code, "no answer")),
      `sentinel=unsent (${code}: no answer)`,
      `${code} before any copy: unsent, which the check only warns on`,
    );
  }
}

{
  for (const code of ["RPC_ERROR", "AUTH_FAILED", "SEND_FAILED"]) {
    assert.equal(
      sentinelVerdict(0, bridgeError(code, "refused")),
      `sentinel=failed (${code}: refused)`,
      `${code} before any copy: failed, which the check fails on`,
    );
  }
}

{
  assert.equal(
    sentinelVerdict(0, bridgeError("ERR_MODULE_NOT_FOUND", "Cannot find module dist/transport/bridge.js")),
    "sentinel=failed (ERR_MODULE_NOT_FOUND: Cannot find module dist/transport/bridge.js)",
    "a missing build (no dist/) is a failure, not an unreachable editor",
  );
}

{
  assert.equal(
    sentinelVerdict(0, new Error("boom")),
    "sentinel=failed (unknown: boom)",
    "an error without a code is a failure",
  );
}

console.log("All 7 tests passed.");
