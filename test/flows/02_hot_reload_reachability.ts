// ═══════════════════════════════════════════════════════════════════════════
// Flow 02 — Hot-reload reachability & stale-live-instance characterisation.
//
// Two boundaries, contrasted:
//
//   • SUPPORTED re-instantiation (extensions.refresh) — covered by Flow 01:
//     re-reading an extension's script and re-registering its tools makes a
//     newly-added tool reachable (4.3+ live / 4.2 deferred). That is the
//     blessed path.
//
//   • UNSUPPORTED in-place edit of a LIVE instance — this flow. A script is
//     attached to a live node; the script file is then edited to add a method;
//     the live node's method table does NOT gain that method until the script
//     reloads / the node is rebuilt. node.call_method returns INVALID_METHOD
//     (node_commands.gd: `node.has_method()` is false). This is the
//     2026-06-09 hazard (41l-duotricies): an agent edited a script and called a
//     new method on a pre-existing live @tool node, got "method not found", and
//     had to relaunch. It feeds the research step → 41m-bis-bis.
//
// RECONCILIATION (decision #5 vs reality): the iter draft framed a "raw
// load(CACHE_MODE_IGNORE).new() via execute_code" as the hazard vector. In fact
// execute.code runs through Expression.execute(), which CANNOT call load() in
// any context — the toolkit explicitly rejects it (editor_commands.gd FIX-H)
// and points users at the node-based workflow: script.write → scene.create_node
// → node.set_script → node.call_method. So the raw-load vector is unreachable
// through the MCP surface (and the 4.2 mid-scan SIGSEGV concern is moot for it);
// the node-based workflow below IS the faithful, SAFE characterisation. The
// only remaining 4.2 IGNORE-mid-scan vector lives inside extensions.refresh and
// is REUSE-gated + guarded by Flow 01.
//
// Operates on Main.tscn without saving (smoke's pattern): probe node created
// then deleted, Main never written. The probe script lives under the probe dir
// and is deleted in cleanup.
// ═══════════════════════════════════════════════════════════════════════════

import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, SCREENSHOT_TIMEOUT } from "../helpers.js";
import { FLOW_PROBE_DIR, ensureProbeDir, cleanupProbeDir } from "./_shared.js";

export const TOOLS_TESTED: string[] = ["node_call_method", "node_set_script", "script_write"];

const PROBE_SCRIPT = `${FLOW_PROBE_DIR}/flow_hot_probe.gd`;
const PROBE_NODE = "FlowHotProbe";

const SCRIPT_V1 = `@tool
extends Node

func flow_marker() -> String:
\treturn "v1"
`;

const SCRIPT_V2 = `@tool
extends Node

func flow_marker() -> String:
\treturn "v2"

func flow_added_method() -> String:
\treturn "added"
`;

async function settleScan(ctx: TestCtx): Promise<void> {
  try {
    // Bridge timeout outlasts the server-side wait so they cannot race.
    await ctx.bridge.call("editor.wait_for_idle", { timeout_ms: 5000 }, SCREENSHOT_TIMEOUT);
  } catch {
    /* best-effort */
  }
}

interface CallResult {
  success?: boolean;
  result?: unknown;
  code?: string;
  error?: string;
}

export async function testHotReloadReachability(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;
  const ver = bridge.getGodotVersionString() ?? "unknown";

  await ensureProbeDir(ctx);

  try {
    // ── Setup: write probe script (v1), attach to a live node ──────────────
    const writeV1 = (await bridge.call(
      "script.write",
      { file_path: PROBE_SCRIPT, content: SCRIPT_V1 },
      CALL_TIMEOUT,
    )) as {
      success?: boolean;
    };
    if (writeV1?.success !== true) {
      fail(`hot-reload SETUP: script.write v1 failed: ${JSON.stringify(writeV1)}`);
      return;
    }
    await settleScan(ctx);

    const createNode = (await bridge.call(
      "scene.create_node",
      { class_name: "Node", parent_path: ".", node_name: PROBE_NODE },
      CALL_TIMEOUT,
    )) as { path?: string; code?: string };
    const nodePath = createNode?.path ?? PROBE_NODE;
    if (!createNode?.path) {
      fail(`hot-reload SETUP: scene.create_node failed: ${JSON.stringify(createNode)}`);
      return;
    }

    const setScript = (await bridge.call(
      "node.set_script",
      { node_path: nodePath, script_path: PROBE_SCRIPT },
      CALL_TIMEOUT,
    )) as { success?: boolean; code?: string };
    if (setScript?.success !== true) {
      fail(`hot-reload SETUP: node.set_script failed: ${JSON.stringify(setScript)}`);
      return;
    }
    pass("hot-reload SETUP: probe script (v1) attached to live node");

    // ── Live instance answers its v1 method ────────────────────────────────
    const markerV1 = (await bridge.call(
      "node.call_method",
      { node_path: nodePath, method_name: "flow_marker" },
      CALL_TIMEOUT,
    )) as CallResult;
    if (markerV1?.success === true && markerV1.result === "v1") pass("hot-reload: live instance flow_marker() -> v1");
    else fail(`hot-reload: flow_marker v1 expected "v1", got ${JSON.stringify(markerV1)}`);

    // ── Deterministic contract: absent method → INVALID_METHOD ─────────────
    // node.has_method() is false for a method that isn't on the live instance.
    const neverAdded = (await bridge.call(
      "node.call_method",
      { node_path: nodePath, method_name: "flow_never_added" },
      CALL_TIMEOUT,
    )) as CallResult;
    if (neverAdded?.success === false && neverAdded.code === "INVALID_METHOD") {
      pass("hot-reload: absent method on live instance -> INVALID_METHOD (contract)");
    } else {
      fail(`hot-reload: expected INVALID_METHOD for absent method, got ${JSON.stringify(neverAdded)}`);
    }

    // ── Characterisation: edit the script to add a method, probe recovery ──
    // These steps RECORD behaviour (they feed the research finding); each is a
    // pass() carrying the observed outcome rather than a hard expectation,
    // because the recovery semantics are exactly what the research step
    // characterises. A crash here (not a clean result) is what would fail.
    const writeV2 = (await bridge.call(
      "script.write",
      { file_path: PROBE_SCRIPT, content: SCRIPT_V2 },
      CALL_TIMEOUT,
    )) as {
      success?: boolean;
    };
    if (writeV2?.success !== true) {
      fail(`hot-reload CHARACTERISE: script.write v2 failed: ${JSON.stringify(writeV2)}`);
    } else {
      // Observe A — immediately after the edit, BEFORE any refresh.
      const afterEdit = (await bridge.call(
        "node.call_method",
        { node_path: nodePath, method_name: "flow_added_method" },
        CALL_TIMEOUT,
      )) as CallResult;
      const aReachable = afterEdit?.success === true;
      pass(
        `hot-reload CHARACTERISE A (no refresh, ${ver}): flow_added_method ${
          aReachable ? "REACHABLE (live instance picked up the edit)" : `STALE (${afterEdit?.code ?? "rejected"})`
        }`,
      );

      // Observe B — after editor.refresh + wait_for_idle (scene-script reload).
      try {
        await bridge.call("editor.refresh", {}, CALL_TIMEOUT);
      } catch {
        /* best-effort */
      }
      await settleScan(ctx);
      const afterRefresh = (await bridge.call(
        "node.call_method",
        { node_path: nodePath, method_name: "flow_added_method" },
        CALL_TIMEOUT,
      )) as CallResult;
      const bReachable = afterRefresh?.success === true;
      pass(
        `hot-reload CHARACTERISE B (editor.refresh, ${ver}): flow_added_method ${
          bReachable ? "REACHABLE" : `STALE (${afterRefresh?.code ?? "rejected"})`
        }`,
      );

      // Observe C — after re-attaching the script (rebuild the binding).
      try {
        await bridge.call("node.set_script", { node_path: nodePath, script_path: PROBE_SCRIPT }, CALL_TIMEOUT);
      } catch {
        /* best-effort */
      }
      const afterRebind = (await bridge.call(
        "node.call_method",
        { node_path: nodePath, method_name: "flow_added_method" },
        CALL_TIMEOUT,
      )) as CallResult;
      const cReachable = afterRebind?.success === true;
      pass(
        `hot-reload CHARACTERISE C (re-set_script, ${ver}): flow_added_method ${
          cReachable ? "REACHABLE" : `STALE (${afterRebind?.code ?? "rejected"})`
        }`,
      );
    }
  } finally {
    try {
      await bridge.call("scene.delete_node", { node_path: PROBE_NODE }, CALL_TIMEOUT);
    } catch {
      /* node may not exist */
    }
    try {
      await bridge.call("script.delete", { file_path: PROBE_SCRIPT }, CALL_TIMEOUT);
    } catch {
      /* already gone */
    }
    await cleanupProbeDir(ctx);
  }
}
