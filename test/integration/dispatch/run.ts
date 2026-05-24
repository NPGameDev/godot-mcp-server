#!/usr/bin/env tsx
// ═══════════════════════════════════════════════════════════════════════════
// Dispatch integration test orchestrator.
//
// Connects to a running Godot editor with the MCP toolkit plugin active,
// creates temporary test scenes, runs 7 dispatch pipeline test flows
// sequentially, then cleans up.
//
// Prerequisites:
//   - Godot editor running with MCP toolkit plugin enabled.
//   - GODOT_MCP_TOKEN env var set (copy from toolkit dock).
//   - GODOT_MCP_PORT env var set (default 6550).
//
// Exit codes:
//   0 — all flows passed
//   1 — one or more flows failed
//   2 — precondition failure (editor not running, missing env vars)
// ═══════════════════════════════════════════════════════════════════════════

import { probePort, HOST, PORT } from "../../helpers.js";
import {
  connectAndAuth,
  sendRequest,
  closeWs,
  resetIdCounter,
  type FlowCtx,
  type FlowFn,
  runWithTimeout,
} from "./helpers.js";

import { run as flow01 } from "./01_mutation_serialization.js";
import { run as flow02 } from "./02_read_bypass.js";
import { run as flow03 } from "./03_queue_drain_fifo.js";
import { run as flow04 } from "./04_notification_timing.js";
import { run as flow05 } from "./05_cancellation.js";
import { run as flow06 } from "./06_peer_disconnect.js";
import { run as flow07 } from "./07_scene_lease.js";

// ─── Constants ──────────────────────────────────────────────────────────

const SCENE_A = "res://test_dispatch_a.tscn";
const SCENE_B = "res://test_dispatch_b.tscn";

const FLOWS: Array<{ name: string; fn: FlowFn }> = [
  { name: "01 mutation serialization", fn: flow01 },
  { name: "02 read bypass", fn: flow02 },
  { name: "03 queue drain FIFO", fn: flow03 },
  { name: "04 notification timing", fn: flow04 },
  { name: "05 cancellation", fn: flow05 },
  { name: "06 peer disconnect", fn: flow06 },
  { name: "07 scene lease", fn: flow07 },
];

// ─── Main ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // --- Preconditions ---

  const token = process.env.GODOT_MCP_TOKEN;
  if (!token) {
    console.error(`[dispatch] ERROR: GODOT_MCP_TOKEN env var is required.

Read the token from the user data path:
  %APPDATA%/Godot/app_userdata/<project>/addons/godot_mcp_toolkit/project_instance_<hash>/mcp_token

Then run:

  GODOT_MCP_TOKEN=<token> npm run test:integration:dispatch`);
    process.exit(2);
  }

  const port = PORT;
  const reachable = await probePort(HOST, port, 2000);
  if (!reachable) {
    console.error(`[dispatch] ERROR: nothing listening on ${HOST}:${port}.

The Godot editor must be running with the MCP toolkit plugin enabled.
Set GODOT_MCP_PORT if using a non-default port.`);
    process.exit(2);
  }

  // --- Scene setup ---

  console.log("[dispatch] Setting up temp scenes...");
  const { ws: setupWs, collector: setupCollector } = await connectAndAuth(port, token);

  // Create scene A.
  const idA = sendRequest(setupWs, "scene.create", {
    file_path: SCENE_A,
    root_type: "Node",
    if_exists: "replace",
  });
  const respA = await setupCollector.waitForResponse(idA);
  if (respA.error) {
    console.error(`[dispatch] Failed to create ${SCENE_A}: ${respA.error.message}`);
    await closeWs(setupWs);
    process.exit(2);
  }

  // Create scene B.
  const idB = sendRequest(setupWs, "scene.create", {
    file_path: SCENE_B,
    root_type: "Node",
    if_exists: "replace",
  });
  const respB = await setupCollector.waitForResponse(idB);
  if (respB.error) {
    console.error(`[dispatch] Failed to create ${SCENE_B}: ${respB.error.message}`);
    await closeWs(setupWs);
    process.exit(2);
  }

  // Open scene A so it's the active tab for mutation flows (1-6).
  const idOpen = sendRequest(setupWs, "scene.open", { file_path: SCENE_A });
  await setupCollector.waitForResponse(idOpen);

  await closeWs(setupWs);
  console.log("[dispatch] Temp scenes ready.\n");

  // --- Run flows ---

  let passed = 0;
  let failed = 0;

  for (const { name, fn } of FLOWS) {
    resetIdCounter();
    const flowPassed: string[] = [];
    const flowFailed: string[] = [];

    const ctx: FlowCtx = {
      pass: (msg) => flowPassed.push(msg),
      fail: (msg) => flowFailed.push(msg),
    };

    try {
      await runWithTimeout(fn, port, token, ctx);
    } catch (err) {
      flowFailed.push(`EXCEPTION: ${err instanceof Error ? err.message : String(err)}`);
    }

    const status = flowFailed.length === 0 ? "PASS" : "FAIL";
    console.log(`[${status}] ${name}`);
    for (const msg of flowPassed) console.log(`  ✓ ${msg}`);
    for (const msg of flowFailed) console.log(`  ✗ ${msg}`);
    console.log();

    if (flowFailed.length === 0) passed++;
    else failed++;
  }

  // --- Scene teardown ---

  console.log("[dispatch] Cleaning up temp scenes...");
  try {
    resetIdCounter();
    const { ws: teardownWs, collector: teardownCollector } = await connectAndAuth(port, token);

    // Close scene B (may or may not be open — ignore errors).
    const idCloseB = sendRequest(teardownWs, "scene.close", { file_path: SCENE_B });
    await teardownCollector.waitForResponse(idCloseB).catch(() => {});

    // Close scene A.
    const idCloseA = sendRequest(teardownWs, "scene.close", { file_path: SCENE_A });
    await teardownCollector.waitForResponse(idCloseA).catch(() => {});

    // Delete scene files.
    const idDelA = sendRequest(teardownWs, "file.delete", { file_path: SCENE_A });
    await teardownCollector.waitForResponse(idDelA).catch(() => {});

    const idDelB = sendRequest(teardownWs, "file.delete", { file_path: SCENE_B });
    await teardownCollector.waitForResponse(idDelB).catch(() => {});

    await closeWs(teardownWs);
  } catch {
    console.warn("[dispatch] Warning: scene teardown had errors (temp files may remain).");
  }

  // --- Summary ---

  console.log(`\n[dispatch] ${passed + failed} flows: ${passed} passed, ${failed} failed.`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[dispatch] Unexpected error:", err);
  process.exit(2);
});
