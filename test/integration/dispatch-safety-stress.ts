#!/usr/bin/env tsx
// ═══════════════════════════════════════════════════════════════════════════
// Deferred-dispatch-safety stress driver  (iteration 41l-tricies)
//
// WHAT THIS IS
//   A high-speed WebSocket "hammer" that connects directly to the godot-mcp
//   toolkit's WebSocket server (bypassing the MCP bridge, exactly like the
//   dispatch integration harness in ./dispatch/) and fires the command
//   sequences that race the editor's deferred-dispatch pipeline against:
//     • a scene save's ProgressDialog re-entering Main::iteration()   (C1)
//     • the raw open_scene_from_path() in the lease-acquire drain, on its own
//       (#75669) and colliding with an active EditorFileSystem scan    (C2)
//
// SELF-DETECTING — YOU DO NOT HAVE TO WATCH THE EDITOR.
//   A dedicated monitor connection runs alongside the storm and decides the
//   verdict automatically:
//     1. Socket drop — if the editor process dies, every WebSocket closes; the
//        monitor sees its own socket drop and reports a crash immediately.
//     2. Health-check ping — every --health-interval ms the monitor fires a
//        cheap *scene-independent* read (project.get_settings, which bypasses
//        the dispatch lock AND the scene queue) and waits up to --health-timeout
//        ms for the reply. No reply ⇒ the editor's main loop is wedged
//        (deadlock/hard-freeze) even though the process is still alive.
//   Exit code: 1 = crash/hang detected, 0 = none detected, 2 = precondition
//   failure. The driver prints which scenario tripped it.
//
//   NOT wired into CI (not in build / test:unit / lint / format / smoke:ci) —
//   it deliberately crashes a *running editor*. Reusable for 41o stress testing.
//
// WHY THE TRIGGERS LOOK THE WAY THEY DO (grounded in mcp_server.gd, pre-fix)
//   • Saves renew the lease every call (dispatch ~L532), so a busy saver never
//     lets scene_lease_ttl_ms (default 8000) elapse — the 8s lease-steal can't
//     fire mid-save. The reliable way to reach the raw open_scene_from_path in
//     _try_acquire_lease (~L674) is to DISCONNECT the lease holder while another
//     peer is queued: instant _release_lease → _drain_scene_queue →
//     _try_acquire_lease → raw synchronous open. That raw open is the #75669
//     crash pattern; overlaid on a scan it is C2.
//   • A near-empty scene saves in microseconds — no ProgressDialog pump. The
//     active scene is pre-populated with --node-count nodes so save_scene's
//     Main::iteration() re-entry spans the 4-frame poll-skip window, and we keep
//     a backlog of scene.open switches buffered so a re-entrant poll has a
//     conflicting command to dispatch (C1).
//   • Connections are kept OPEN through each storm (v1 closed after ~8 saves and
//     proved nothing); each scenario drains before closing.
//
// RED / GREEN — THE PRE-FIX COMMIT IS THE CONTROL.
//   Committed BEFORE the toolkit fix and shown to crash/hang the editor on Godot
//   4.2 AND 4.5 (RED ⇒ exit 1). The pre-fix commit IS the reproducible control —
//   `git checkout` it any time. After the fix, this SAME driver must detect NO
//   crash on 4.2 and 4.5 (GREEN ⇒ exit 0). A green that was never red proves
//   nothing: if the pre-fix editor survives, raise --iterations / --node-count.
//
// PREREQUISITES
//   • A Godot editor running with the MCP toolkit plugin enabled, opened on the
//     toolkit dogfood project (toolkit repo root). Run ONE editor version at a
//     time (4.2, then 4.5) — two editors bind different ports/tokens.
//   • GODOT_MCP_TOKEN = the token from that editor's MCP dock (or the mcp_token
//     file under the project's user data dir). GODOT_MCP_PORT if not 6550.
//
// USAGE
//   GODOT_MCP_TOKEN=<token> npx tsx test/integration/dispatch-safety-stress.ts [flags]
//   GODOT_MCP_TOKEN=<token> npm run stress:dispatch -- [flags]
//
//   --scenario <name>      refresh-storm | smoke-storm | rapid-save | concurrent-save |
//                          multi-save | scan-collision | all               (default: all)
//   --iterations <N>       loop count per scenario                          (default: 200)
//   --node-count <N>       nodes in the heavy active scene (save weight)     (default: 250)
//   --open-scripts <N>     temp .gd scripts to create + open in the IN-EDITOR
//                          script editor before the storm — reloaded by every
//                          editor.refresh (the leading-hypothesis condition)  (default: 8)
//   --duration <sec>       loop the selected scenario(s) until this many seconds
//                          elapse or a crash is detected; 0 = single pass     (default: 0)
//   --health-interval <ms> gap between health-check pings                    (default: 1000)
//   --health-timeout <ms>  max wait for a health-check reply before          (default: 10000)
//                          declaring the editor crashed/frozen
//   --no-cleanup           leave temp scenes/scripts in place (default: best-effort delete)
//   --help
//
//   Scenarios:
//     refresh-storm   LEADING HYPOTHESIS. With --open-scripts .gd files open in
//                     the in-editor script editor, overlap editor.refresh (full:
//                     scan() + reload(true) every open script) with save re-entry,
//                     scene.open switches, and live script.write edits. Reload
//                     churn + save re-entry + active-scan scene ops stack C1+C2 on
//                     top of script-editor UI work — the condition the original
//                     crashes had that no prior stress run reproduced.
//     smoke-storm     Zero-delay diverse hammer mirroring a no-delay smoke pass
//                     (refresh / save / scene-op adjacency at zero inter-call gap).
//     rapid-save      C1: one client, heavy active scene. Sustained
//                     editor.save_scene interleaved with scene.open switches
//                     (bypass the mutation lock at dispatch ~L510) and
//                     scene.get_tree reads — a re-entrant poll during a save
//                     dispatches a scene switch / read mid-serialization.
//     concurrent-save C1 (multi-client): two peers race a heavy save's
//                     Main::iteration() re-entry — the lease holder pumps
//                     editor.save_scene + switches its scene away mid-save while a
//                     second peer floods reads/mutations. Surfaced the
//                     overlapping-save EditorProgress collision (41l-tricies).
//     multi-save      Raw-open drain (#75669): repeated rounds where peer A
//                     takes scene A's lease, peer B queues a scene command on
//                     scene B, then A disconnects → the drain calls the raw
//                     open_scene_from_path (mcp_server.gd ~L674).
//     scan-collision  C2: the same raw-open drain, but a full filesystem scan
//                     (editor.refresh) is kicked immediately before A drops, so
//                     the raw open collides with the active scan.
// ═══════════════════════════════════════════════════════════════════════════

import WebSocket from "ws";

import { probePort, HOST, PORT } from "../helpers.js";
import { connectAndAuth, sendRequest, closeWs, resetIdCounter } from "./dispatch/helpers.js";

// ─── Temp scenes (created in the dogfood project root; cleaned up best-effort) ──
const SCENE_A = "res://_stress_dispatch_a.tscn";
const SCENE_B = "res://_stress_dispatch_b.tscn";

const scriptPaths = (n: number): string[] => Array.from({ length: n }, (_, i) => `res://_stress_script_${i}.gd`);

// Valid standalone GDScript with enough lines for a breakpoint at line 3. `rev`
// changes the source so editor.refresh's reload(true) genuinely re-parses it (an
// unchanged reload can early-out; a changed one churns the script-editor UI).
function scriptBody(i: number, rev: number): string {
  return [
    "extends Node",
    `# stress script ${i}`,
    `var _rev := ${rev}`,
    "func _ready() -> void:",
    `\tprint("stress ${i} rev ${rev}")`,
    "func compute() -> int:",
    `\treturn ${i} * (_rev + 1)`,
    "",
  ].join("\n");
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type Conn = Awaited<ReturnType<typeof connectAndAuth>>;

/** Shared verdict. The monitor writes it; scenarios read it to bail early. */
type CrashState = { crashed: boolean; reason: string; scenario: string };

function flagCrash(crash: CrashState, reason: string): void {
  if (crash.crashed) return;
  crash.crashed = true;
  crash.reason = reason;
  console.log(`\n[stress] ❌ CRASH/HANG AUTO-DETECTED during "${crash.scenario}": ${reason}`);
}

// ─── CLI ────────────────────────────────────────────────────────────────────

type Args = {
  scenario: string;
  iterations: number;
  nodeCount: number;
  openScripts: number;
  durationSec: number;
  healthInterval: number;
  healthTimeout: number;
  cleanup: boolean;
};

const SCENARIOS = [
  "refresh-storm",
  "smoke-storm",
  "rapid-save",
  "concurrent-save",
  "multi-save",
  "scan-collision",
  "all",
];

function parseArgs(argv: string[]): Args {
  const args: Args = {
    scenario: "all",
    iterations: 200,
    nodeCount: 250,
    openScripts: 8,
    durationSec: 0,
    healthInterval: 1000,
    healthTimeout: 10000,
    cleanup: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    const eq = tok.indexOf("=");
    const key = eq >= 0 ? tok.slice(0, eq) : tok;
    const inline = eq >= 0 ? tok.slice(eq + 1) : argv[i + 1];
    const consume = (): string | undefined => {
      if (eq < 0) i++;
      return inline;
    };
    if (key === "--scenario") {
      const v = consume();
      if (v === undefined || !SCENARIOS.includes(v)) {
        console.error(`[stress] Unknown --scenario "${v}" (expected ${SCENARIOS.join(" | ")})`);
        process.exit(2);
      }
      args.scenario = v;
    } else if (key === "--iterations") {
      args.iterations = Math.max(1, Number(consume()) || 200);
    } else if (key === "--node-count") {
      args.nodeCount = Math.max(0, Number(consume()) || 250);
    } else if (key === "--open-scripts") {
      args.openScripts = Math.max(0, Number(consume()) || 0);
    } else if (key === "--duration") {
      args.durationSec = Math.max(0, Number(consume()) || 0);
    } else if (key === "--health-interval") {
      args.healthInterval = Math.max(100, Number(consume()) || 1000);
    } else if (key === "--health-timeout") {
      args.healthTimeout = Math.max(1000, Number(consume()) || 10000);
    } else if (key === "--no-cleanup") {
      args.cleanup = false;
    } else if (key === "--help" || key === "-h") {
      console.log("[stress] See the header comment in this file for full usage.");
      process.exit(0);
    } else {
      console.error(`[stress] Unknown flag "${tok}"`);
      process.exit(2);
    }
  }
  return args;
}

// ─── Send / liveness helpers ──────────────────────────────────────────────────

/**
 * Send fire-and-forget, tolerating a socket the editor closed underneath us (a
 * crash drops the connection mid-storm). Returns true if the frame was handed
 * to the socket.
 */
function safeSend(conn: Conn, method: string, params?: Record<string, unknown>): boolean {
  if (conn.ws.readyState !== WebSocket.OPEN) return false;
  try {
    sendRequest(conn.ws, method, params);
    return true;
  } catch {
    return false;
  }
}

// Every authenticated socket is registered here so a SIGINT/SIGTERM (or any
// early stop) closes them ALL before exit. Otherwise a killed driver orphans
// connected peers that keep holding the editor's scene lease / mutation lock —
// exactly how the editor's mutation pipeline got wedged during the hunt.
const liveSockets = new Set<WebSocket>();

/**
 * Track whether the editor is still talking to us. `closed` resolves (never
 * rejects) the moment the socket closes or errors — also acts as the no-op
 * "error" sink so an abrupt editor death can't throw an unhandled 'error'.
 * Registers the socket in `liveSockets` for graceful shutdown.
 */
function watch(conn: Conn): { state: { alive: boolean }; closed: Promise<void> } {
  const state = { alive: true };
  let resolveClosed: () => void = () => {};
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  liveSockets.add(conn.ws);
  const done = () => {
    liveSockets.delete(conn.ws);
    if (state.alive) {
      state.alive = false;
      resolveClosed();
    }
  };
  conn.ws.on("close", done);
  conn.ws.on("error", done);
  return { state, closed };
}

/** Sleep in small steps, bailing as soon as a crash is detected or the peer dies. */
async function settle(ms: number, live: { alive: boolean }, crash: CrashState): Promise<void> {
  for (let t = 0; t < ms && live.alive && !crash.crashed; t += 100) {
    await sleep(100);
  }
}

function report(name: string, sent: number, conn: Conn, alive: boolean): void {
  const received = conn.collector.messages.length;
  const drop = alive ? "" : " (this peer's connection dropped)";
  console.log(`[stress]   ${name}: sent ${sent} request(s); ${received} message(s) received${drop}`);
}

// ─── Health monitor (the auto crash/hang oracle) ───────────────────────────────

async function startHealthMonitor(
  port: number,
  token: string,
  crash: CrashState,
  args: Args,
): Promise<() => Promise<void>> {
  const conn = await connectAndAuth(port, token);
  const { state, closed } = watch(conn);
  let stopped = false;

  let cycle = 0;
  const loop = (async () => {
    while (!stopped && !crash.crashed) {
      if (!state.alive) {
        flagCrash(crash, "monitor WebSocket dropped (editor process died)");
        return;
      }
      // Fast READ liveness ping (bypasses the dispatch lock + scene queue).
      const rid = sendRequest(conn.ws, "project.get_settings", { prefix: "application/config" });
      const rOut = await Promise.race([
        conn.collector
          .waitForResponse(rid, args.healthTimeout)
          .then(() => "ok")
          .catch(() => "no-response"),
        closed.then(() => "closed"),
      ]);
      if (stopped) return;
      if (rOut === "closed") {
        flagCrash(crash, "monitor WebSocket dropped mid-ping (editor process died)");
        return;
      }
      if (rOut === "no-response") {
        flagCrash(crash, `editor did not answer a health-check read within ${args.healthTimeout}ms (crashed or froze)`);
        return;
      }
      // Every ~5th cycle, also confirm MUTATIONS aren't wedged (C3). Reads pass
      // even when _mutation_in_flight is stuck true, so a read-only monitor
      // false-greens on a mutation wedge. The timeout is generous so a merely
      // busy pipeline (heavy storm) doesn't false-flag — only a permanent wedge
      // outlasts it.
      if (cycle % 5 === 4) {
        const mid = sendRequest(conn.ws, "scene.create_node", { class_name: "Node", node_name: `_mutprobe_${cycle}` });
        const mTimeout = Math.max(20000, args.healthTimeout * 2);
        const mOut = await Promise.race([
          conn.collector
            .waitForResponse(mid, mTimeout)
            .then(() => "ok")
            .catch(() => "no-response"),
          closed.then(() => "closed"),
        ]);
        if (stopped) return;
        if (mOut === "closed") {
          flagCrash(crash, "monitor WebSocket dropped during mutation probe (editor process died)");
          return;
        }
        if (mOut === "no-response") {
          flagCrash(
            crash,
            `MUTATION pipeline wedged: reads answer but scene.create_node got no reply in ${mTimeout}ms (C3 mutation-lock leak)`,
          );
          return;
        }
      }
      cycle++;
      conn.collector.clear(); // keep memory bounded over a long run
      await sleep(args.healthInterval);
    }
  })();

  return async () => {
    stopped = true;
    await loop.catch(() => {});
    await closeWs(conn.ws).catch(() => {});
  };
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

/** Create both temp scenes, then pre-populate scene A with `nodeCount` nodes so
 *  its saves are heavy enough to open a real ProgressDialog re-entry window. */
async function setupScenes(port: number, token: string, args: Args): Promise<void> {
  const conn = await connectAndAuth(port, token);
  watch(conn);
  try {
    for (const file_path of [SCENE_A, SCENE_B]) {
      const id = sendRequest(conn.ws, "scene.create", { file_path, root_type: "Node", if_exists: "replace" });
      await conn.collector.waitForResponse(id).catch(() => {});
    }
    const idOpen = sendRequest(conn.ws, "scene.open", { file_path: SCENE_A });
    await conn.collector.waitForResponse(idOpen).catch(() => {});
    console.log(`[stress] populating ${SCENE_A} with ${args.nodeCount} nodes (heavy save weight)...`);
    for (let i = 0; i < args.nodeCount; i++) {
      const id = sendRequest(conn.ws, "scene.create_node", { class_name: "Node", node_name: `_heavy_${i}` });
      if (i % 20 === 0) await conn.collector.waitForResponse(id).catch(() => {});
    }
    const idSave = sendRequest(conn.ws, "editor.save_scene");
    await conn.collector.waitForResponse(idSave, 30000).catch(() => {});
  } finally {
    await closeWs(conn.ws).catch(() => {});
  }
}

/**
 * Create `openScripts` temp .gd scripts and OPEN each in the IN-EDITOR script
 * editor via debug.set_breakpoint → EditorInterface.edit_script. This is the
 * leading-hypothesis condition no prior stress run reproduced: editor.refresh
 * (full mode) then scan()s and reload(true)s EVERY open script, so open scripts
 * add re-entrant UI/reload work that widens the C1/C2 crash window. These STACK
 * on top of any scripts the human already has open in the editor.
 */
async function setupScripts(port: number, token: string, args: Args): Promise<void> {
  if (args.openScripts <= 0) return;
  const conn = await connectAndAuth(port, token);
  watch(conn);
  const paths = scriptPaths(args.openScripts);
  try {
    for (let i = 0; i < paths.length; i++) {
      const idW = sendRequest(conn.ws, "script.write", { file_path: paths[i], content: scriptBody(i, 0) });
      await conn.collector.waitForResponse(idW, 10000).catch(() => {});
      // Open in the in-editor script editor (edit_script) + set a breakpoint.
      const idB = sendRequest(conn.ws, "debug.set_breakpoint", { file_path: paths[i], line: 3 });
      await conn.collector.waitForResponse(idB, 10000).catch(() => {});
    }
    console.log(
      `[stress] opened ${paths.length} temp script(s) in the in-editor script editor — editor.refresh now reloads them (these stack on any you opened manually).`,
    );
  } finally {
    await closeWs(conn.ws).catch(() => {});
  }
}

async function cleanup(port: number, token: string, args: Args): Promise<void> {
  try {
    const conn = await connectAndAuth(port, token);
    watch(conn);
    for (const file_path of [SCENE_A, SCENE_B]) {
      sendRequest(conn.ws, "scene.close", { file_path });
      await sleep(80);
    }
    for (const file_path of [SCENE_A, SCENE_B]) {
      sendRequest(conn.ws, "file.delete", { file_path });
      await sleep(80);
    }
    // Delete only OUR temp scripts — never the human's manually-opened files.
    for (const file_path of scriptPaths(args.openScripts)) {
      sendRequest(conn.ws, "script.delete", { file_path });
      await sleep(60);
    }
    await sleep(200);
    await closeWs(conn.ws).catch(() => {});
  } catch {
    console.warn("[stress] cleanup skipped (editor unreachable — likely crashed; temp scenes/scripts may remain).");
  }
}

// ─── Scenarios ────────────────────────────────────────────────────────────────

// PRIMARY repro — zero-delay diverse hammer. Mirrors a no-delay smoke pass: a
// rotation across many tools where each command awaits its reply, then the next
// fires IMMEDIATELY with no sleep (the inter-call gap that a 100ms delay was
// added to the real smoke suite to create). The danger is adjacency at zero
// delay — an editor.refresh / editor.save_scene kicks an EditorFileSystem scan
// that is still running when the very next scene op executes → the deferred-poll
// / scan-collision crash the delay was hiding.
async function scenarioSmokeStorm(port: number, token: string, args: Args, crash: CrashState): Promise<void> {
  console.log(`\n[stress] ── smoke-storm (zero-delay diverse hammer) — ${args.iterations} rounds ──`);
  const conn = await connectAndAuth(port, token);
  const { state: live } = watch(conn);
  try {
    const idOpen = sendRequest(conn.ws, "scene.open", { file_path: SCENE_A });
    await conn.collector.waitForResponse(idOpen).catch(() => {});

    let sent = 0;
    const step = async (method: string, params?: Record<string, unknown>): Promise<void> => {
      if (!live.alive || crash.crashed || conn.ws.readyState !== WebSocket.OPEN) return;
      const id = sendRequest(conn.ws, method, params);
      sent++;
      await conn.collector.waitForResponse(id, 5000).catch(() => {}); // backpressure, NO sleep
    };
    for (let i = 0; i < args.iterations && live.alive && !crash.crashed; i++) {
      await step("scene.create_node", { class_name: "Node", node_name: `_s_${i}` });
      await step("editor.refresh"); // scan
      await step("editor.save_scene"); // save while the scan may still be running
      await step("scene.get_tree");
      await step("scene.open", { file_path: SCENE_B }); // scene op
      await step("editor.refresh"); // scan
      await step("scene.open", { file_path: SCENE_A }); // scene op during scan
      await step("editor.save_scene");
      await step("scene.delete_node", { node_path: `./_s_${i}` });
      await step("editor.get_console");
      await step("project.get_settings", { prefix: "application/config" });
      if (i % 25 === 24) conn.collector.clear(); // bound memory over a long run
    }
    report("smoke-storm", sent, conn, live.alive);
  } finally {
    await closeWs(conn.ws).catch(() => {});
  }
}

// LEADING-HYPOTHESIS repro (the condition the original crashes had that no prior
// stress run did): with --open-scripts .gd files open in the IN-EDITOR script
// editor, overlap editor.refresh (full: scan() + reload(true) on EVERY open
// script) — fired fire-and-forget so its scan is still live — with
// editor.save_scene (ProgressDialog Main::iteration re-entry), scene.open
// switches, and live script.write edits so each reload re-parses changed source.
// Script-editor reload churn + save re-entry + active-scan scene ops stack the
// C1 and C2 windows on top of UI work. These overlap any scripts you opened by
// hand. Connection stays open; drains at the end.
async function scenarioRefreshStorm(port: number, token: string, args: Args, crash: CrashState): Promise<void> {
  console.log(`\n[stress] ── refresh-storm (open-script reload + save re-entry) — ${args.iterations} rounds ──`);
  const conn = await connectAndAuth(port, token);
  const { state: live } = watch(conn);
  const paths = scriptPaths(args.openScripts);
  let rev = 1;
  try {
    const idOpen = sendRequest(conn.ws, "scene.open", { file_path: SCENE_A });
    await conn.collector.waitForResponse(idOpen).catch(() => {});

    let sent = 0;
    for (let i = 0; i < args.iterations && live.alive && !crash.crashed; i++) {
      // Mutate one open script so the next reload(true) genuinely re-parses it.
      if (paths.length > 0 && i % 2 === 0) {
        const p = paths[i % paths.length];
        if (safeSend(conn, "script.write", { file_path: p, content: scriptBody(i % paths.length, rev++) })) sent++;
      }
      if (safeSend(conn, "editor.refresh")) sent++; // full: scan() + reload(true) all open scripts
      if (safeSend(conn, "scene.open", { file_path: SCENE_B })) sent++; // races the active scan (C2)
      if (safeSend(conn, "editor.save_scene")) sent++; // save re-entry overlapping scan + reload churn
      if (safeSend(conn, "scene.open", { file_path: SCENE_A })) sent++;
      if (safeSend(conn, "editor.save_scene")) sent++;
      // Pace to avoid overflowing the WS buffer, but always leave a backlog
      // buffered so a re-entrant poll during a save has work to dispatch.
      if (i % 3 === 2) await sleep(20);
    }
    await settle(8000, live, crash); // drain the backlog — do NOT close early
    report("refresh-storm", sent, conn, live.alive);
  } finally {
    await closeWs(conn.ws).catch(() => {});
  }
}

// C1: heavy active scene, one client. Sustained saves with scene.open switches
// (bypass the mutation lock at dispatch ~L510, so they can dispatch re-entrantly
// during a save and swap the edited scene mid-serialization) + scene.get_tree
// reads. Connection stays open; we drain at the end rather than close early.
async function scenarioRapidSave(port: number, token: string, args: Args, crash: CrashState): Promise<void> {
  console.log(`\n[stress] ── rapid-save (C1: save re-entry) — ${args.iterations} rounds ──`);
  const conn = await connectAndAuth(port, token);
  const { state: live } = watch(conn);
  try {
    const idOpen = sendRequest(conn.ws, "scene.open", { file_path: SCENE_A });
    await conn.collector.waitForResponse(idOpen).catch(() => {});

    let sent = 0;
    for (let i = 0; i < args.iterations && live.alive && !crash.crashed; i++) {
      if (safeSend(conn, "editor.save_scene")) sent++;
      if (safeSend(conn, "scene.open", { file_path: SCENE_B })) sent++; // switch away mid-save
      if (safeSend(conn, "scene.get_tree")) sent++;
      if (safeSend(conn, "editor.save_scene")) sent++;
      if (safeSend(conn, "scene.open", { file_path: SCENE_A })) sent++; // switch back
      if (safeSend(conn, "scene.get_tree")) sent++;
      // Pace so the editor keeps chewing (and re-entering) without overflowing
      // the buffer, but always leaves a backlog buffered during saves.
      if (i % 4 === 3) await sleep(15);
    }
    await settle(8000, live, crash); // let the backlog drain — do NOT close early
    report("rapid-save", sent, conn, live.alive);
  } finally {
    await closeWs(conn.ws).catch(() => {});
  }
}

// Raw-open drain (#75669): peer A takes scene A's lease, peer B queues a scene
// command on scene B, then A disconnects → _release_lease → _drain_scene_queue →
// _try_acquire_lease → raw open_scene_from_path(B) (mcp_server.gd ~L674).
// Repeated; each round uses a fresh A so the lease starts clean.
async function scenarioMultiSave(port: number, token: string, args: Args, crash: CrashState): Promise<void> {
  console.log(`\n[stress] ── multi-save (raw-open drain / #75669) — ${args.iterations} rounds ──`);
  let rounds = 0;
  let lastB: Conn | null = null;
  try {
    for (let i = 0; i < args.iterations && !crash.crashed; i++) {
      const a = await connectAndAuth(port, token);
      const b = await connectAndAuth(port, token);
      const { state: liveA } = watch(a);
      const { state: liveB } = watch(b);
      lastB = b;
      // A takes the lease on scene A (active tab = A).
      const idA = sendRequest(a.ws, "scene.open", { file_path: SCENE_A });
      await a.collector.waitForResponse(idA).catch(() => {});
      // B contends on scene B → affinity B, scene NOT opened.
      const idB = sendRequest(b.ws, "scene.open", { file_path: SCENE_B });
      await b.collector.waitForResponse(idB).catch(() => {});
      // B queues a scene-requiring command (affinity B ≠ active A → _scene_queue).
      safeSend(b, "scene.create_node", { class_name: "Node", node_name: `_q_${i}` });
      await sleep(30);
      // Drop A → drain → raw open(B).
      await closeWs(a.ws).catch(() => {});
      rounds++;
      await sleep(50);
      await closeWs(b.ws).catch(() => {}); // reset lease state for the next round
      if (!liveA.alive && !liveB.alive && !crash.crashed) {
        // Both peers' sockets dropped without the monitor flagging yet — let it.
        await sleep(50);
      }
    }
    if (lastB) report("multi-save", rounds, lastB, true);
  } finally {
    if (lastB) await closeWs(lastB.ws).catch(() => {});
  }
}

// C2: the same raw-open drain, but a full filesystem scan is kicked from a third
// peer immediately before A drops, so the raw open_scene_from_path collides with
// the active EditorFileSystem scan.
async function scenarioScanCollision(port: number, token: string, args: Args, crash: CrashState): Promise<void> {
  console.log(`\n[stress] ── scan-collision (C2: raw open during scan) — ${args.iterations} rounds ──`);
  const c = await connectAndAuth(port, token); // persistent scan trigger
  watch(c);
  let rounds = 0;
  let lastB: Conn | null = null;
  try {
    for (let i = 0; i < args.iterations && !crash.crashed; i++) {
      const a = await connectAndAuth(port, token);
      const b = await connectAndAuth(port, token);
      watch(a);
      const { state: liveB } = watch(b);
      lastB = b;
      const idA = sendRequest(a.ws, "scene.open", { file_path: SCENE_A });
      await a.collector.waitForResponse(idA).catch(() => {});
      const idB = sendRequest(b.ws, "scene.open", { file_path: SCENE_B });
      await b.collector.waitForResponse(idB).catch(() => {});
      safeSend(b, "scene.create_node", { class_name: "Node", node_name: `_qs_${i}` });
      // Kick a full filesystem scan, then immediately drop A so the drain's raw
      // open lands while is_scanning() is still true.
      safeSend(c, "editor.refresh");
      await sleep(10);
      await closeWs(a.ws).catch(() => {});
      rounds++;
      await sleep(60);
      await closeWs(b.ws).catch(() => {});
      if (!liveB.alive && !crash.crashed) await sleep(50);
    }
    if (lastB) report("scan-collision", rounds, lastB, true);
  } finally {
    if (lastB) await closeWs(lastB.ws).catch(() => {});
    await closeWs(c.ws).catch(() => {});
  }
}

// C1 (MULTI-CLIENT): two peers race a heavy save's ProgressDialog re-entry. Peer A
// holds the lease on the heavy active scene and pumps editor.save_scene; peer B
// floods reads + scene.open + mutations so the packet buffer is never empty when
// A's save re-enters Main::iteration(). A re-entrant _poll_connections then
// dispatches a buffered command MID-SAVE — reads + scene.open bypass the mutation
// lock, so they execute immediately even while the save is in flight, the exact
// mid-save dispatch Fix 2's is_dispatching() guard must block. A also switches its
// own active scene mid-save (the single-client vector), amplified by B's pressure.
// Pre-fix: mid-save dispatch corrupts editor state (RED). Fixed: the guard skips
// the re-entrant tick (GREEN).
async function scenarioConcurrentSave(port: number, token: string, args: Args, crash: CrashState): Promise<void> {
  console.log(`\n[stress] ── concurrent-save (C1: multi-client save re-entry) — ${args.iterations} rounds ──`);
  const a = await connectAndAuth(port, token);
  const b = await connectAndAuth(port, token);
  const { state: liveA } = watch(a);
  const { state: liveB } = watch(b);
  try {
    const idOpen = sendRequest(a.ws, "scene.open", { file_path: SCENE_A });
    await a.collector.waitForResponse(idOpen).catch(() => {});

    let sent = 0;
    for (let i = 0; i < args.iterations && liveA.alive && liveB.alive && !crash.crashed; i++) {
      // A (lease holder): heavy save, then IMMEDIATELY switch its own active scene
      // AWAY — when that buffered switch dispatches during the save's re-entrant
      // poll, it swaps the edited scene out from under the in-flight save (the C1
      // corruption). B floods so the buffer is never empty when the save re-enters.
      if (safeSend(a, "editor.save_scene")) sent++; // heavy save → ProgressDialog re-entry
      if (safeSend(a, "scene.open", { file_path: SCENE_B })) sent++; // switch AWAY mid-save (C1 vector)
      if (safeSend(b, "scene.get_tree")) sent++; // read — bypasses the mutation lock
      if (safeSend(b, "scene.create_node", { class_name: "Node", node_name: `_cc_${i}` })) sent++;
      if (safeSend(b, "project.get_settings", { prefix: "application/config" })) sent++;
      if (safeSend(a, "scene.open", { file_path: SCENE_A })) sent++; // A back on the heavy scene
      if (safeSend(a, "editor.save_scene")) sent++; // and saves it again
      if (i % 3 === 2) await sleep(8); // leave a backlog buffered during saves
    }
    await settle(8000, liveA, crash); // drain — do NOT close early
    report("concurrent-save", sent, a, liveA.alive);
  } finally {
    await closeWs(a.ws).catch(() => {});
    await closeWs(b.ws).catch(() => {});
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function printBanner(args: Args, port: number): void {
  const bar = "═".repeat(78);
  console.log(bar);
  console.log("[stress] deferred-dispatch-safety stress driver (41l-tricies)");
  console.log(
    `[stress]   port=${port}  scenario=${args.scenario}  iterations=${args.iterations}  node-count=${args.nodeCount}`,
  );
  console.log(
    `[stress]   open-scripts=${args.openScripts}  duration=${args.durationSec === 0 ? "single-pass" : args.durationSec + "s"}`,
  );
  console.log("[stress]   self-detecting crash/hang oracle — exit 1 = crash detected, 0 = none. Not wired into CI.");
  console.log(bar);
}

function printSummary(crash: CrashState): void {
  const bar = "═".repeat(78);
  console.log(`\n${bar}`);
  if (crash.crashed) {
    console.log(`[stress] ❌ CRASH/HANG DETECTED during "${crash.scenario}": ${crash.reason}`);
    console.log("[stress]    Pre-fix toolkit → expected RED baseline. Record this scenario as the known crash flow.");
    console.log("[stress]    Fixed toolkit   → the fix is INCOMPLETE. Do NOT commit / proceed.");
    console.log("[stress]    (exit 1)");
  } else {
    console.log("[stress] ✅ NO CRASH/HANG DETECTED across all scenarios run.");
    console.log("[stress]    Pre-fix toolkit → driver isn't exercising the race; raise --iterations / --node-count.");
    console.log("[stress]                       A green that was never red proves nothing.");
    console.log("[stress]    Fixed toolkit   → expected GREEN result.");
    console.log("[stress]    (exit 0)");
  }
  console.log(bar);
}

// Close every tracked socket on Ctrl-C / kill so we never orphan a connected
// peer. A hard SIGKILL / `taskkill /F` can't be caught, but Ctrl-C (SIGINT) and
// TaskStop-style SIGTERM are catchable — and running via a single `npx tsx`
// process (not the `npm run` wrapper tree) means the signal actually reaches us.
function installSignalHandlers(): void {
  let shuttingDown = false;
  const shutdown = (sig: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[stress] ${sig} — closing ${liveSockets.size} open socket(s) so no peer is orphaned...`);
    for (const ws of liveSockets) {
      try {
        ws.close();
      } catch {
        /* already closing */
      }
    }
    setTimeout(() => process.exit(130), 400);
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

async function main(): Promise<void> {
  installSignalHandlers();
  const args = parseArgs(process.argv.slice(2));

  const token = process.env.GODOT_MCP_TOKEN;
  if (!token) {
    console.error(`[stress] ERROR: GODOT_MCP_TOKEN env var is required.

Read the token from the toolkit's MCP dock, or from:
  %APPDATA%/Godot/app_userdata/<project>/addons/godot_mcp_toolkit/project_instance_<hash>/mcp_token

Then run (ONE editor version at a time):
  GODOT_MCP_TOKEN=<token> npm run stress:dispatch -- --scenario all`);
    process.exit(2);
  }

  const port = PORT;
  if (!(await probePort(HOST, port, 2000))) {
    console.error(
      `[stress] ERROR: nothing listening on ${HOST}:${port}. Open the toolkit project in Godot with the MCP plugin enabled (set GODOT_MCP_PORT for a non-default port).`,
    );
    process.exit(2);
  }

  printBanner(args, port);
  resetIdCounter();

  const crash: CrashState = { crashed: false, reason: "", scenario: "setup" };

  await setupScenes(port, token, args);
  await setupScripts(port, token, args);

  const stopMonitor = await startHealthMonitor(port, token, crash, args);
  console.log(
    `[stress] health monitor active — ping every ${args.healthInterval}ms, ${args.healthTimeout}ms timeout. Watching for crashes automatically.`,
  );

  const scenarios: Array<[string, (p: number, t: string, a: Args, c: CrashState) => Promise<void>]> = [
    ["refresh-storm", scenarioRefreshStorm],
    ["smoke-storm", scenarioSmokeStorm],
    ["rapid-save", scenarioRapidSave],
    ["concurrent-save", scenarioConcurrentSave],
    ["multi-save", scenarioMultiSave],
    ["scan-collision", scenarioScanCollision],
  ];

  // --duration > 0 loops the selected scenario(s) until the deadline or a crash.
  // The crash is intermittent ⇒ the VOLUME of attempts is what matters; the
  // monitor catches it whenever it finally lands.
  const deadline = args.durationSec > 0 ? Date.now() + args.durationSec * 1000 : 0;
  try {
    let pass = 0;
    do {
      pass++;
      if (deadline) {
        const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
        console.log(`\n[stress] ══ duration pass ${pass} — ${left}s remaining (looping until crash or 0s) ══`);
      }
      for (const [name, fn] of scenarios) {
        if (args.scenario !== "all" && args.scenario !== name) continue;
        if (crash.crashed) break;
        crash.scenario = name;
        await fn(port, token, args, crash);
        if (crash.crashed) break;
      }
    } while (!crash.crashed && deadline && Date.now() < deadline);
  } finally {
    await stopMonitor();
  }

  if (!crash.crashed && args.cleanup) {
    console.log("\n[stress] cleaning up temp scenes + scripts (best-effort)...");
    await cleanup(port, token, args);
  }

  printSummary(crash);
  process.exit(crash.crashed ? 1 : 0);
}

main().catch((err) => {
  console.error("[stress] Unexpected error:", err);
  process.exit(1);
});
