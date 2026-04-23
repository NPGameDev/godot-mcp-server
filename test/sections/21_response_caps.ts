import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, unwrapUntrusted } from "../helpers.js";

export async function testResponseCaps(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  // ── 256 KB response cap (Phase 8, item 5) ─────────────────────────────
  // Generate a ~300 KB script file to exceed the 256 KB cap.
  const largeLine = "# " + "x".repeat(997) + "\n"; // ~1000 bytes per line
  const largeContent = largeLine.repeat(300); // ~300 KB
  const largePath = "res://smoke_large_script.gd";

  const writeResult = (await bridge.call(
    "script.write",
    {
      file_path: largePath,
      content: largeContent,
    },
    CALL_TIMEOUT,
  )) as { ok?: boolean };
  if (!writeResult?.ok) {
    fail(`response cap: could not write large file: ${JSON.stringify(writeResult)}`);
    return;
  }

  // script_read should return FILE_TOO_LARGE for the oversized file.
  const readResult = (await bridge.call(
    "script.read",
    {
      file_path: largePath,
    },
    CALL_TIMEOUT,
  )) as {
    success?: boolean;
    code?: string;
    total_bytes?: number;
    hint?: string;
  };
  if (readResult?.code !== "FILE_TOO_LARGE") {
    fail(`response cap: expected FILE_TOO_LARGE, got ${JSON.stringify(readResult)?.slice(0, 200)}`);
  } else if (typeof readResult.total_bytes !== "number" || readResult.total_bytes < 262144) {
    fail(`response cap: FILE_TOO_LARGE missing/invalid total_bytes: ${readResult.total_bytes}`);
  } else if (!readResult.hint?.includes("script_read_range")) {
    fail(`response cap: FILE_TOO_LARGE missing hint: ${readResult.hint}`);
  } else {
    pass(`response cap: script_read 300KB -> FILE_TOO_LARGE (${readResult.total_bytes} bytes)`);
  }

  // ── script_read_range happy path ──────────────────────────────────────
  const rangeResult = (await bridge.call(
    "script.read_range",
    {
      file_path: largePath,
      start_line: 1,
      end_line: 100,
    },
    CALL_TIMEOUT,
  )) as {
    content?: string;
    start_line?: number;
    end_line?: number;
    total_lines?: number;
    code?: string;
  };
  if (rangeResult?.code) {
    fail(`script_read_range: unexpected error: ${JSON.stringify(rangeResult)}`);
  } else if (typeof rangeResult?.content !== "string" || !rangeResult.content.includes("<untrusted")) {
    fail(`script_read_range: missing/unwrapped content: ${JSON.stringify(rangeResult)?.slice(0, 200)}`);
  } else if (rangeResult.start_line !== 1 || rangeResult.end_line !== 100) {
    fail(`script_read_range: wrong line range: ${rangeResult.start_line}-${rangeResult.end_line}`);
  } else {
    const inner = unwrapUntrusted(rangeResult.content) as string;
    const lineCount = inner.split("\n").length;
    if (lineCount !== 100) {
      fail(`script_read_range: expected 100 lines, got ${lineCount}`);
    } else {
      pass(`script_read_range: 1-100 of ${rangeResult.total_lines} lines`);
    }
  }

  // Cleanup: delete the large file.
  await bridge.call("script.delete", { file_path: largePath }, CALL_TIMEOUT);

  // ── meta.set_limits (iter 38) ────────────────────────────────────────────
  const limitsResult = (await bridge.call(
    "meta.set_limits",
    { script_read_cap_kb: 512, ws_buffer_kb: 2048 },
    CALL_TIMEOUT,
  )) as { success?: boolean; script_read_cap_kb?: number; ws_buffer_kb?: number };
  if (!limitsResult?.success || limitsResult.script_read_cap_kb !== 512 || limitsResult.ws_buffer_kb !== 2048) {
    fail(`meta.set_limits: expected success with 512/2048, got ${JSON.stringify(limitsResult)}`);
  } else {
    pass("meta.set_limits: accepted overrides 512KB/2048KB");
  }

  // Verify floor clamping — values below minimums should be clamped.
  const floorResult = (await bridge.call(
    "meta.set_limits",
    { script_read_cap_kb: 1, ws_buffer_kb: 1 },
    CALL_TIMEOUT,
  )) as { success?: boolean; script_read_cap_kb?: number; ws_buffer_kb?: number };
  if (!floorResult?.success || floorResult.script_read_cap_kb !== 64 || floorResult.ws_buffer_kb !== 256) {
    fail(`meta.set_limits floor: expected 64/256, got ${JSON.stringify(floorResult)}`);
  } else {
    pass("meta.set_limits: clamped below-floor values to 64KB/256KB");
  }

  // Reset to defaults so later tests are unaffected.
  await bridge.call("meta.set_limits", { script_read_cap_kb: 256, ws_buffer_kb: 1024 }, CALL_TIMEOUT);
}
