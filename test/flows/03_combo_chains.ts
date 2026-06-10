// ═══════════════════════════════════════════════════════════════════════════
// Flow 03 — Combo chains (sweep S22 → flows, gap-only).
//
// Only cross-tool, *stateful* chains smoke does not sequence. Smoke tests each
// tool in isolation; these two need state carried across multiple tools to
// observe:
//
//   • C4 — signal persistence across save/reopen. Smoke §05 checks the connect
//     HINT (single call) but never the connection SURVIVING editor.save_scene +
//     scene.open away + back. In-scene self-connection persists (cross-scene
//     does not — signal_commands.gd).
//
//   • C8 — node-management pipeline. Each op (duplicate/rename/reparent/groups)
//     is individually covered, but the CHAIN (operate on the result of the
//     previous step) is a distinct cross-tool-state flow.
//
// Triage note (decisions #3/#4): the other S22 chains are already covered by
// smoke's per-tool sections and are NOT duplicated here — C3 scene build (§02/
// §08/§10), C6 tilemap paint (§44/§13), C12 folder.delete-with-open-tabs
// (§09 — already exercises the open-tab auto-switch), and every single-call
// coercion/param/error regression-watch item (smoke's domain). See the Flow
// Suite section of SMOKE-COVERAGE-MANIFEST.md.
//
// C4 saves a dedicated probe scene under the probe dir; C8 runs on Main without
// saving (smoke's pattern). Cleanup is guaranteed via the probe-dir sweep.
// ═══════════════════════════════════════════════════════════════════════════

import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT } from "../helpers.js";
import { FLOW_PROBE_DIR, ensureProbeDir, cleanupProbeDir, restoreMainScene } from "./_shared.js";

export const TOOLS_TESTED: string[] = ["signal_manage", "signal_list", "node_manage", "node_groups"];

const SIGNAL_SCENE = `${FLOW_PROBE_DIR}/flow_signal.tscn`;

interface SignalListResult {
  signals?: { name?: string; connections?: unknown[] }[];
  code?: string;
}

function connectionsFor(res: SignalListResult, signalName: string): unknown[] {
  const sig = (res?.signals ?? []).find((s) => s.name === signalName);
  return Array.isArray(sig?.connections) ? (sig!.connections as unknown[]) : [];
}

// ─── C4: signal persistence across save/reopen ──────────────────────────────
async function comboSignalPersistence(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  const createScene = (await bridge.call(
    "scene.create",
    { file_path: SIGNAL_SCENE, root_type: "Node2D", if_exists: "return" },
    CALL_TIMEOUT,
  )) as { success?: boolean; code?: string };
  if (createScene?.success !== true) {
    fail(`combo C4: scene.create failed: ${JSON.stringify(createScene)}`);
    return;
  }
  await bridge.call("scene.open", { file_path: SIGNAL_SCENE }, CALL_TIMEOUT);

  const sigNode = (await bridge.call(
    "scene.create_node",
    { class_name: "Node", parent_path: ".", node_name: "FlowSig" },
    CALL_TIMEOUT,
  )) as { path?: string };
  const sigPath = sigNode?.path ?? "FlowSig";

  // In-scene self-connection (persists; cross-scene would not).
  const connect = (await bridge.call(
    "signal.manage",
    {
      action: "connect",
      source_path: sigPath,
      signal_name: "child_order_changed",
      target_path: sigPath,
      method_name: "notify_property_list_changed",
    },
    CALL_TIMEOUT,
  )) as { status?: string; code?: string };
  if (connect?.status !== "created") {
    fail(`combo C4: signal connect expected status='created', got ${JSON.stringify(connect)}`);
    return;
  }
  pass("combo C4: signal connected in-scene");

  // Save → switch away → switch back.
  const save = (await bridge.call("editor.save_scene", {}, CALL_TIMEOUT)) as { success?: boolean; code?: string };
  if (save?.success !== true) {
    fail(`combo C4: editor.save_scene failed: ${JSON.stringify(save)}`);
    return;
  }
  await restoreMainScene(ctx); // switch away to Main
  await bridge.call("scene.open", { file_path: SIGNAL_SCENE }, CALL_TIMEOUT); // switch back

  const afterReopen = (await bridge.call(
    "signal.list",
    { node_path: sigPath, include_connections: true },
    CALL_TIMEOUT,
  )) as SignalListResult;
  const conns = connectionsFor(afterReopen, "child_order_changed");
  if (conns.length > 0) pass(`combo C4: connection persisted across save/reopen (${conns.length} conn)`);
  else fail(`combo C4: connection did NOT persist — signal.list shows ${JSON.stringify(afterReopen?.signals)}`);

  // Disconnect (tidy; the scene is deleted in cleanup regardless).
  try {
    await bridge.call(
      "signal.manage",
      {
        action: "disconnect",
        source_path: sigPath,
        signal_name: "child_order_changed",
        target_path: sigPath,
        method_name: "notify_property_list_changed",
      },
      CALL_TIMEOUT,
    );
  } catch {
    /* best-effort */
  }
}

// ─── C8: node-management pipeline (on Main, no save) ─────────────────────────
async function comboNodePipeline(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  await restoreMainScene(ctx); // operate on Main

  const base = (await bridge.call(
    "scene.create_node",
    { class_name: "Sprite2D", parent_path: ".", node_name: "FlowNM" },
    CALL_TIMEOUT,
  )) as { path?: string; code?: string };
  if (!base?.path) {
    fail(`combo C8: scene.create_node FlowNM failed: ${JSON.stringify(base)}`);
    return;
  }

  try {
    // duplicate → rename the copy → reparent it under the original → group it.
    const dup = (await bridge.call(
      "node.manage",
      { action: "duplicate", node_path: "FlowNM", new_name: "FlowNMCopy" },
      CALL_TIMEOUT,
    )) as { success?: boolean; code?: string };
    if (dup?.success !== true) {
      fail(`combo C8: duplicate failed: ${JSON.stringify(dup)}`);
      return;
    }
    pass("combo C8: duplicate FlowNM -> FlowNMCopy");

    const ren = (await bridge.call(
      "node.manage",
      { action: "rename", node_path: "FlowNMCopy", new_name: "FlowNMRenamed" },
      CALL_TIMEOUT,
    )) as { success?: boolean; new_path?: string; code?: string };
    if (ren?.success !== true) {
      fail(`combo C8: rename failed: ${JSON.stringify(ren)}`);
      return;
    }
    pass("combo C8: rename FlowNMCopy -> FlowNMRenamed");

    const rep = (await bridge.call(
      "node.manage",
      { action: "reparent", node_path: "FlowNMRenamed", new_parent_path: "FlowNM" },
      CALL_TIMEOUT,
    )) as { success?: boolean; code?: string };
    if (rep?.success !== true) {
      fail(`combo C8: reparent failed: ${JSON.stringify(rep)}`);
      return;
    }
    pass("combo C8: reparent FlowNMRenamed under FlowNM");

    // Group ops on the reparented node (now at FlowNM/FlowNMRenamed).
    const reparented = "FlowNM/FlowNMRenamed";
    const addG = (await bridge.call(
      "node.groups",
      { action: "add", node_path: reparented, group: "flow_c8" },
      CALL_TIMEOUT,
    )) as { success?: boolean; code?: string };
    const listG = (await bridge.call("node.groups", { action: "list", node_path: reparented }, CALL_TIMEOUT)) as {
      groups?: string[];
      code?: string;
    };
    if (addG?.success === true && Array.isArray(listG?.groups) && listG.groups.includes("flow_c8")) {
      pass("combo C8: group add+list -> flow_c8 present on reparented node");
    } else {
      fail(`combo C8: group add/list mismatch: add=${JSON.stringify(addG)} list=${JSON.stringify(listG)}`);
    }
    await bridge.call("node.groups", { action: "remove", node_path: reparented, group: "flow_c8" }, CALL_TIMEOUT);
  } finally {
    // Delete the base node (recursive removal takes the reparented child too).
    try {
      await bridge.call("scene.delete_node", { node_path: "FlowNM" }, CALL_TIMEOUT);
    } catch {
      /* best-effort */
    }
  }
}

export async function testComboChains(ctx: TestCtx): Promise<void> {
  await ensureProbeDir(ctx);
  try {
    await comboSignalPersistence(ctx);
    await comboNodePipeline(ctx);
  } finally {
    await restoreMainScene(ctx);
    await cleanupProbeDir(ctx);
  }
}
