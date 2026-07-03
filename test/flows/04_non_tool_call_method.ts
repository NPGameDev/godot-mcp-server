// ═══════════════════════════════════════════════════════════════════════════
// Flow 04 — non-@tool call_method necessary-condition guard.
//
// A non-@tool GDScript attached to an editor node never RUNS in the editor:
// has_method() sees the on-disk method, so node.call_method reaches callv(),
// but the engine reports "Method not found" and the call yields null. The
// toolkit's null-result hint must name that cause and steer runtime-first
// (game.start + runtime tools) before the version-gated @tool remediation.
//
// CI attests ONLY the deterministic in-session necessary condition:
//   1. constant method on a non-@tool script → call yields null + the
//      cause-naming hint (anchored on a version-stable substring — the
//      remediation tail after "(2) editor" varies by Godot version).
//   2. after flipping the script to @tool (+ editor_refresh), the call either
//      becomes callable (reload took effect) or stays null-with-hint — BOTH
//      accepted: headless hot-reload re-instantiation is an async-scan/idle
//      timing race, so the GUI minimum-remediation ladder is owned by the
//      interactive sweep, never asserted here.
// Probe artifacts live under res://flow_probes/ (pre-cleaned + finally-cleaned).
// ═══════════════════════════════════════════════════════════════════════════

import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, SCREENSHOT_TIMEOUT } from "../helpers.js";
import { FLOW_PROBE_DIR, ensureProbeDir, cleanupProbeDir } from "./_shared.js";

export const TOOLS_TESTED: string[] = ["node_call_method", "node_set_script", "script_write", "editor_refresh"];

// Version-stable substring of the null-result cause hint (the remediation tail
// is version-gated: scene close+reopen on 4.5+, editor relaunch below).
const NON_TOOL_CAUSE_MARKER = "A non-@tool GDScript never runs in the editor";

const PROBE_SCRIPT = `${FLOW_PROBE_DIR}/flow_non_tool_probe.gd`;
const PROBE_NODE = "FlowNonToolProbe";
const PROBE_METHOD = "flow_constant_probe";

const NON_TOOL_SRC = `extends Node\n\nfunc ${PROBE_METHOD}() -> String:\n\treturn "constant"\n`;
const TOOL_SRC = `@tool\n${NON_TOOL_SRC}`;

interface CallResult {
  success?: boolean;
  result?: unknown;
  code?: string;
  error?: string;
  hint?: string;
}

async function callProbe(ctx: TestCtx, nodePath: string): Promise<CallResult> {
  return (await ctx.bridge.call(
    "node.call_method",
    { node_path: nodePath, method_name: PROBE_METHOD },
    CALL_TIMEOUT,
  )) as CallResult;
}

async function settleScan(ctx: TestCtx): Promise<void> {
  try {
    await ctx.bridge.call("editor.wait_for_idle", { timeout_ms: 5000 }, SCREENSHOT_TIMEOUT);
  } catch {
    /* best-effort */
  }
}

export async function testNonToolCallMethod(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  // Clean slate so the probe write is a genuine CREATE (orphans from a dead
  // prior run would otherwise turn it into an existing-edit).
  await cleanupProbeDir(ctx);
  await ensureProbeDir(ctx);

  let nodePath: string | null = null;
  try {
    // ── Fixture: non-@tool script with a constant method, on a live node ──
    const write = (await bridge.call(
      "script.write",
      { file_path: PROBE_SCRIPT, content: NON_TOOL_SRC },
      CALL_TIMEOUT,
    )) as { success?: boolean; valid?: boolean };
    if (write?.success !== true || write.valid !== true) {
      fail(`SETUP: script.write non-@tool probe failed: ${JSON.stringify(write)}`);
      return;
    }
    await settleScan(ctx);

    const created = (await bridge.call(
      "scene.create_node",
      { class_name: "Node", parent_path: ".", node_name: PROBE_NODE },
      CALL_TIMEOUT,
    )) as { path?: string };
    nodePath = created?.path ?? null;
    if (!nodePath) {
      fail(`SETUP: scene.create_node failed: ${JSON.stringify(created)}`);
      return;
    }
    const attached = (await bridge.call(
      "node.set_script",
      { node_path: nodePath, script_path: PROBE_SCRIPT },
      CALL_TIMEOUT,
    )) as { success?: boolean };
    if (attached?.success !== true) {
      fail(`SETUP: node.set_script failed: ${JSON.stringify(attached)}`);
      return;
    }

    // ── Deterministic branch: null result + the cause-naming hint ──
    const first = await callProbe(ctx, nodePath);
    if (first?.result == null && typeof first?.hint === "string" && first.hint.includes(NON_TOOL_CAUSE_MARKER)) {
      pass(`non-@tool call -> null + cause-naming hint present`);
    } else {
      fail(`non-@tool call: expected null result + "${NON_TOOL_CAUSE_MARKER}" hint, got ${JSON.stringify(first)}`);
    }

    // ── Racy branch: @tool flip + refresh — accept BOTH outcomes ──
    const flip = (await bridge.call("script.write", { file_path: PROBE_SCRIPT, content: TOOL_SRC }, CALL_TIMEOUT)) as {
      success?: boolean;
    };
    if (flip?.success !== true) {
      fail(`FLIP: script.write @tool version failed: ${JSON.stringify(flip)}`);
      return;
    }
    try {
      await bridge.call("editor.refresh", {}, CALL_TIMEOUT);
    } catch {
      /* best-effort */
    }
    await settleScan(ctx);

    const second = await callProbe(ctx, nodePath);
    if (second?.success === true && second.result === "constant") {
      pass(`@tool flip -> callable (in-session reload took effect)`);
    } else if (second?.result == null && typeof second?.hint === "string" && second.hint.length > 0) {
      pass(`@tool flip -> still null (reload did not take effect in-session) + hint present`);
    } else {
      fail(`@tool flip: expected callable OR null-with-hint, got ${JSON.stringify(second)}`);
    }
  } finally {
    if (nodePath) {
      try {
        await bridge.call("scene.delete_node", { node_path: nodePath }, CALL_TIMEOUT);
      } catch {
        /* node may not exist */
      }
    }
    await cleanupProbeDir(ctx);
  }
}
