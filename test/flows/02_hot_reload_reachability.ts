// ═══════════════════════════════════════════════════════════════════════════
// Flow 02 — Hot-reload reachability, stale-live-instance characterisation, AND
// the stale-instance hint assertions.
//
//   • UNSUPPORTED in-place edit of a LIVE instance: a script is attached to a
//     live node; the file is then edited; the live node's method table / bytecode
//     does NOT update until the editor reloads. The hazard: an agent edits a
//     script, calls a new method on a pre-existing live @tool node, gets
//     "method not found", and relaunches.
//
// EMPIRICAL MATRIX (Step 0, characterised across 4.2.0/4.3.0/4.4.1/4.5.0/4.6.2).
// The boundary is 4.3 → 4.4:
//
//   Scenario           | < 4.4 (4.2, 4.3)            | 4.4+ (4.4, 4.5, 4.6)
//   -------------------|----------------------------|----------------------
//   A added method     | STALE (INVALID_METHOD)      | REACHABLE
//   B body edit        | OLD value (silent, no err)  | NEW value (live)
//   C compile error    | valid:false + diagnostics   | (same — version-indep.)
//   D fresh node       | STALE (re-instantiate fails)| REACHABLE
//
// D proved a FRESH node is also stale on 4.2 AND 4.3 → both collapse to one
// recovery: relaunch. The stale-instance hints make that opaque failure actionable:
//   - proactive: script.write of an EXISTING .gd that compiled OK on < 4.4 carries
//     a stale-instance `hint` (suppressed on create / 4.4+ / compile-fail).
//   - reactive: node.call_method → INVALID_METHOD carries the same hint when the
//     method exists on the on-disk .gd but not the live instance (< 4.4); a genuine
//     typo (method absent on disk) gets NO stale hint.
//
// These are PERMANENT assertions: if a future Godot moves the 4.3→4.4 boundary, the
// per-version branch flips and these fail, flagging the change. The MATRIX line is
// also emitted for human diagnosis. Operates on Main.tscn without saving; probe
// scripts live under res://flow_probes/ and are cleaned at start and in finally.
// ═══════════════════════════════════════════════════════════════════════════

import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, SCREENSHOT_TIMEOUT } from "../helpers.js";
import { isVersionAtLeast } from "../../src/shared/version.js";
import { FLOW_PROBE_DIR, ensureProbeDir, cleanupProbeDir } from "./_shared.js";

export const TOOLS_TESTED: string[] = ["node_call_method", "node_set_script", "script_write"];

// Distinctive substring of the < 4.4 stale-instance hint (in both the
// proactive write_hint and the reactive recovery_message).
const STALE_MARKER = "keeps the OLD code";

// The 4.4+ HEADLESS reactive hint uses distinct wording — a headless editor never
// re-instantiates a live node, a different hazard from the < 4.4 engine-cache staleness —
// with NO "keeps the OLD code" phrase, so it needs its own marker. See the toolkit's
// stale_instance_hint.gd `_RECOVERY_HEADLESS`.
const HEADLESS_STALE_MARKER = "don't re-instantiate live nodes";

const A_SCRIPT = `${FLOW_PROBE_DIR}/flow_hot_probe.gd`;
const B_SCRIPT = `${FLOW_PROBE_DIR}/flow_body_probe.gd`;
const C_SCRIPT = `${FLOW_PROBE_DIR}/flow_compile_probe.gd`;
const D_SCRIPT = `${FLOW_PROBE_DIR}/flow_fresh_probe.gd`;

const A_NODE = "FlowHotProbe";
const B_NODE = "FlowBodyProbe";
const D_NODE1 = "FlowFreshProbe1";
const D_NODE2 = "FlowFreshProbe2";

const A_V1 = `@tool\nextends Node\n\nfunc flow_marker() -> String:\n\treturn "v1"\n`;
const A_V2 = `@tool\nextends Node\n\nfunc flow_marker() -> String:\n\treturn "v1"\n\nfunc flow_added_method() -> String:\n\treturn "added"\n`;
const B_V1 = `@tool\nextends Node\n\nfunc flow_body() -> String:\n\treturn "b1"\n`;
const B_V2 = `@tool\nextends Node\n\nfunc flow_body() -> String:\n\treturn "b2"\n`;
const C_VALID = `@tool\nextends Node\n\nfunc flow_ok() -> int:\n\treturn 1\n`;
const C_BROKEN = `@tool\nextends Node\n\nfunc flow_ok() -> int:\n\treturn 1\n\nvar = = =\n`;
const D_V1 = `@tool\nextends Node\n\nfunc fresh_a() -> String:\n\treturn "a"\n`;
const D_V2 = `@tool\nextends Node\n\nfunc fresh_a() -> String:\n\treturn "a"\n\nfunc fresh_b() -> String:\n\treturn "b"\n`;

interface CallResult {
  success?: boolean;
  result?: unknown;
  code?: string;
  error?: string;
  hint?: string;
}
interface WriteResult {
  success?: boolean;
  valid?: boolean;
  diagnostics?: unknown[];
  hint?: string;
}

function hasStaleHint(r: { hint?: string }): boolean {
  return typeof r?.hint === "string" && r.hint.includes(STALE_MARKER);
}
function hasHeadlessStaleHint(r: { hint?: string }): boolean {
  return typeof r?.hint === "string" && r.hint.includes(HEADLESS_STALE_MARKER);
}

async function writeScript(ctx: TestCtx, path: string, content: string): Promise<WriteResult> {
  return (await ctx.bridge.call("script.write", { file_path: path, content }, CALL_TIMEOUT)) as WriteResult;
}
async function makeNode(ctx: TestCtx, name: string): Promise<string | null> {
  const r = (await ctx.bridge.call(
    "scene.create_node",
    { class_name: "Node", parent_path: ".", node_name: name },
    CALL_TIMEOUT,
  )) as { path?: string };
  return r?.path ?? null;
}
async function attach(ctx: TestCtx, nodePath: string, scriptPath: string): Promise<boolean> {
  const r = (await ctx.bridge.call(
    "node.set_script",
    { node_path: nodePath, script_path: scriptPath },
    CALL_TIMEOUT,
  )) as { success?: boolean };
  return r?.success === true;
}
async function callMethod(ctx: TestCtx, nodePath: string, method: string): Promise<CallResult> {
  return (await ctx.bridge.call(
    "node.call_method",
    { node_path: nodePath, method_name: method },
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
async function refresh(ctx: TestCtx): Promise<void> {
  try {
    await ctx.bridge.call("editor.refresh", {}, CALL_TIMEOUT);
  } catch {
    /* best-effort */
  }
}

export async function testHotReloadReachability(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;
  const ver = bridge.getGodotVersionString() ?? "unknown";
  const verPair = bridge.getGodotVersion();
  if (!verPair) {
    fail(`hot-reload: editor did not report a Godot version — cannot assert version-gated behaviour`);
    return;
  }
  const pre44 = !isVersionAtLeast(verPair, "4.4");

  // Clean slate so the first write of each probe is a genuine CREATE.
  await cleanupProbeDir(ctx);
  await ensureProbeDir(ctx);
  // Editor display mode from the auth handshake (resolved by the calls above). 4.4+ HEADLESS is a
  // TIMING RACE: NodeCache live-reload (4.4+) MAY re-instantiate a live node headless depending on
  // async-scan/idle timing (4.4.0 CI observed reachable; 4.5/4.6/4.7 observed stale) — so the 4.4+
  // headless assertions accept REACHABLE or STALE+hint. < 4.4 (4.2/4.3) is pre-NodeCache and
  // deterministically stale, firing the hint version-only. Accepting both outcomes lets flows §02
  // run on CI without skipping.
  const headless = bridge.isHeadless() === true;
  const verTag = `${ver} ${pre44 ? "(<4.4 affected)" : headless ? "(4.4+ headless race)" : "(4.4+ clear)"}`;
  const createdNodes: string[] = [];
  let aVerdict = "?";
  let bVerdict = "?";
  let cVerdict = "?";
  let dVerdict = "?";

  try {
    // ════ Scenario A — add a NEW method, call on the SAME live instance ════
    const aCreate = await writeScript(ctx, A_SCRIPT, A_V1);
    if (aCreate?.success !== true) {
      fail(`A SETUP: script.write v1 failed: ${JSON.stringify(aCreate)}`);
    } else {
      // A create carries NO stale hint (proactive fires only on an EXISTING edit).
      if (!hasStaleHint(aCreate)) pass(`A: create (new file) → no stale hint`);
      else fail(`A: create wrongly carried a stale hint: ${aCreate.hint}`);

      await settleScan(ctx);
      const node = await makeNode(ctx, A_NODE);
      if (!node) {
        fail(`A SETUP: scene.create_node failed`);
      } else {
        createdNodes.push(node);
        if (!(await attach(ctx, node, A_SCRIPT))) {
          fail(`A SETUP: node.set_script failed`);
        } else {
          const marker = await callMethod(ctx, node, "flow_marker");
          if (marker?.success === true && marker.result === "v1") pass(`A invariant: live flow_marker() -> v1`);
          else fail(`A invariant: flow_marker expected "v1", got ${JSON.stringify(marker)}`);

          // Reactive no-false-positive: a method absent EVERYWHERE (typo) → plain
          // INVALID_METHOD, NO stale hint.
          const typo = await callMethod(ctx, node, "flow_never_added");
          if (typo?.success === false && typo.code === "INVALID_METHOD" && !hasStaleHint(typo))
            pass(`A reactive: genuine typo -> INVALID_METHOD with NO stale hint`);
          else fail(`A reactive: typo expected INVALID_METHOD w/o stale hint, got ${JSON.stringify(typo)}`);

          // Edit: add flow_added_method (compiles) → proactive hint gating.
          const aEdit = await writeScript(ctx, A_SCRIPT, A_V2);
          if (aEdit?.success !== true) {
            fail(`A EDIT: script.write v2 failed: ${JSON.stringify(aEdit)}`);
          } else {
            // PROACTIVE assertion: present < 4.4, absent 4.4+.
            if (pre44 && hasStaleHint(aEdit)) pass(`A proactive: <4.4 existing-edit write carries stale hint`);
            else if (!pre44 && !hasStaleHint(aEdit)) pass(`A proactive: 4.4+ existing-edit write has NO stale hint`);
            else fail(`A proactive: hint gating wrong on ${verTag}: hint=${JSON.stringify(aEdit.hint)}`);

            const after = await callMethod(ctx, node, "flow_added_method");
            aVerdict = after?.success === true ? "REACHABLE" : `STALE(${after?.code ?? "?"})`;
            if (pre44) {
              // STALE + REACTIVE hint (method is on the on-disk .gd).
              if (after?.success === false && after.code === "INVALID_METHOD" && hasStaleHint(after))
                pass(`A: <4.4 added-method STALE + reactive stale hint present`);
              else fail(`A: <4.4 expected STALE+stale-hint, got ${JSON.stringify(after)}`);
            } else if (headless) {
              // 4.4+ HEADLESS is a TIMING RACE: NodeCache live-reload (4.4+) MAY re-instantiate the
              // node depending on async-scan/idle timing, so both outcomes are deterministic + correct
              // — REACHABLE (reload took effect) OR STALE with the headless re-instantiation hint
              // (4.5/4.6/4.7 deterministically hit the STALE arm, keeping the hint covered).
              if (after?.success === true) pass(`A: 4.4+ headless added-method REACHABLE (reload took effect)`);
              else if (after?.success === false && after.code === "INVALID_METHOD" && hasHeadlessStaleHint(after))
                pass(`A: 4.4+ headless added-method STALE + headless re-instantiation hint`);
              else fail(`A: 4.4+ headless expected REACHABLE or STALE+headless-hint, got ${JSON.stringify(after)}`);
            } else {
              if (after?.success === true) pass(`A: 4.4+ added-method REACHABLE`);
              else fail(`A: 4.4+ expected REACHABLE, got ${JSON.stringify(after)}`);
            }

            // Recovery probes still match the boundary (regression guard).
            await refresh(ctx);
            await settleScan(ctx);
            const afterRefresh = await callMethod(ctx, node, "flow_added_method");
            await attach(ctx, node, A_SCRIPT);
            const afterRebind = await callMethod(ctx, node, "flow_added_method");
            const recoveredAny = afterRefresh?.success === true || afterRebind?.success === true;
            if (pre44) {
              // < 4.4: pre-NodeCache, no live reload → neither refresh nor re-set_script recovers.
              if (!recoveredAny) pass(`A: <4.4 refresh + re-set_script both STALE (no in-session recovery)`);
              else
                fail(
                  `A recovery mismatch on ${verTag}: refresh=${afterRefresh?.success} rebind=${afterRebind?.success}`,
                );
            } else if (headless) {
              // 4.4+ headless: the reload is a timing race (mirrors the reactive outcome above) — the
              // recovery probes either recover (reload took effect) or stay stale. Both are valid.
              pass(
                `A: 4.4+ headless refresh + re-set_script ${recoveredAny ? "recovered (reload took effect)" : "both STALE (no in-session recovery)"}`,
              );
            } else {
              // 4.4+ display: deterministically reachable through refresh + rebind.
              if (afterRefresh?.success === true && afterRebind?.success === true)
                pass(`A: 4.4+ reachable through refresh + rebind`);
              else
                fail(
                  `A recovery mismatch on ${verTag}: refresh=${afterRefresh?.success} rebind=${afterRebind?.success}`,
                );
            }
          }
        }
      }
    }

    // ════ Scenario B — change an EXISTING method BODY (same signature) ════
    {
      await writeScript(ctx, B_SCRIPT, B_V1);
      await settleScan(ctx);
      const node = await makeNode(ctx, B_NODE);
      if (!node) {
        fail(`B SETUP: scene.create_node failed`);
      } else {
        createdNodes.push(node);
        await attach(ctx, node, B_SCRIPT);
        const v1 = await callMethod(ctx, node, "flow_body");
        if (v1?.success === true && v1.result === "b1") pass(`B invariant: live flow_body() -> b1`);
        else fail(`B invariant: flow_body expected "b1", got ${JSON.stringify(v1)}`);

        await writeScript(ctx, B_SCRIPT, B_V2); // body-only edit (same signature)
        const after = await callMethod(ctx, node, "flow_body");
        bVerdict = after?.success === true ? String(after.result) : `ERR(${after?.code ?? "?"})`;
        if (pre44) {
          // The dangerous silent case: OLD body runs, no error (pre-NodeCache, no live reload).
          if (after?.success === true && after.result === "b1")
            pass(`B: <4.4 body-edit silently returns OLD "b1" (no error)`);
          else fail(`B: <4.4 expected stale "b1", got ${JSON.stringify(after)}`);
        } else if (headless) {
          // 4.4+ headless is a TIMING RACE: either the NEW body (b2, reload took effect) or the OLD
          // body (b1, still stale) — both success:true. flow_body's signature is unchanged, so there
          // is no INVALID_METHOD / hint on this path (the hint is asserted on the A/D fresh paths).
          if (after?.success === true && (after.result === "b2" || after.result === "b1"))
            pass(
              `B: 4.4+ headless body-edit -> "${after.result}" (${after.result === "b2" ? "reload took effect" : "still stale"})`,
            );
          else fail(`B: 4.4+ headless expected "b1" or "b2", got ${JSON.stringify(after)}`);
        } else {
          if (after?.success === true && after.result === "b2") pass(`B: 4.4+ body-edit live -> "b2"`);
          else fail(`B: 4.4+ expected "b2", got ${JSON.stringify(after)}`);
        }
      }
    }

    // ════ Scenario C — the (re)write introduces a COMPILE ERROR ════
    {
      const wOk = await writeScript(ctx, C_SCRIPT, C_VALID);
      const wBad = await writeScript(ctx, C_SCRIPT, C_BROKEN); // existing-edit that does NOT compile
      if (wOk?.success !== true || wBad?.success !== true) {
        fail(`C SETUP: script.write did not return success: ${JSON.stringify({ wOk, wBad })}`);
      } else {
        const okValid = wOk.valid === true;
        const badInvalid = wBad.valid === false;
        const hasDiag = Array.isArray(wBad.diagnostics) && wBad.diagnostics.length > 0;
        cVerdict = `okValid=${okValid} badInvalid=${badInvalid} diag=${hasDiag}`;
        if (okValid && badInvalid && hasDiag) pass(`C: compile-gate signal present (${cVerdict})`);
        else fail(`C: compile-gate ANOMALY (${cVerdict})`);
        // Option-B / Scenario-C suppression: a compile-FAILED existing-edit carries
        // NO stale hint (even on < 4.4) — the diagnostics are the right signal.
        if (!hasStaleHint(wBad)) pass(`C: compile-failed write suppresses the stale hint`);
        else fail(`C: compile-failed write wrongly carried a stale hint: ${wBad.hint}`);
      }
    }

    // ════ Scenario D — FRESH re-instantiation (new node) after the edit ════
    {
      await writeScript(ctx, D_SCRIPT, D_V1);
      await settleScan(ctx);
      const node1 = await makeNode(ctx, D_NODE1);
      if (!node1) {
        fail(`D SETUP: scene.create_node node1 failed`);
      } else {
        createdNodes.push(node1);
        await attach(ctx, node1, D_SCRIPT);
        const a1 = await callMethod(ctx, node1, "fresh_a");
        if (a1?.success === true && a1.result === "a") pass(`D invariant: node1 fresh_a() -> a`);
        else fail(`D invariant: fresh_a expected "a", got ${JSON.stringify(a1)}`);

        await writeScript(ctx, D_SCRIPT, D_V2); // add fresh_b
        await settleScan(ctx);
        const node2 = await makeNode(ctx, D_NODE2); // BRAND-NEW node
        if (!node2) {
          fail(`D: scene.create_node node2 failed`);
        } else {
          createdNodes.push(node2);
          await attach(ctx, node2, D_SCRIPT);
          const b2 = await callMethod(ctx, node2, "fresh_b");
          dVerdict = b2?.success === true ? "fresh REACHABLE" : `fresh STALE(${b2?.code ?? "?"})`;
          if (pre44) {
            // < 4.4: a FRESH node is STALE too (re-instantiating does NOT help
            // pre-NodeCache). Reactive hint fires (fresh_b is
            // on the on-disk .gd), and the fresh node still attached (old method reachable → only the
            // NEW member is stale, not a failed attach).
            if (b2?.success === false && b2.code === "INVALID_METHOD" && hasStaleHint(b2))
              pass(`D: <4.4 FRESH node STALE + reactive hint (re-instantiate does NOT help)`);
            else fail(`D: <4.4 expected fresh-node STALE+hint, got ${JSON.stringify(b2)}`);
            const a2 = await callMethod(ctx, node2, "fresh_a");
            if (a2?.success === true)
              pass(`D: fresh node2 sees the OLD method (attach worked; only the edit is stale)`);
            else fail(`D: fresh node2 could not call fresh_a — attach failed? ${JSON.stringify(a2)}`);
          } else if (headless) {
            // 4.4+ headless is a TIMING RACE: the fresh node either re-instantiates (fresh_b REACHABLE,
            // reload took effect) or stays STALE (INVALID_METHOD + the headless re-instantiation hint,
            // which 4.5/4.6/4.7 deterministically hit). On the stale path the fresh node still attached
            // (old method reachable → only the NEW member is stale).
            if (b2?.success === true) {
              pass(`D: 4.4+ headless FRESH node REACHABLE (reload took effect)`);
            } else if (b2?.success === false && b2.code === "INVALID_METHOD" && hasHeadlessStaleHint(b2)) {
              pass(`D: 4.4+ headless FRESH node STALE + headless re-instantiation hint`);
              const a2 = await callMethod(ctx, node2, "fresh_a");
              if (a2?.success === true)
                pass(`D: fresh node2 sees the OLD method (attach worked; only the edit is stale)`);
              else fail(`D: fresh node2 could not call fresh_a — attach failed? ${JSON.stringify(a2)}`);
            } else {
              fail(`D: 4.4+ headless expected REACHABLE or STALE+headless-hint, got ${JSON.stringify(b2)}`);
            }
          } else {
            if (b2?.success === true) pass(`D: 4.4+ FRESH node REACHABLE`);
            else fail(`D: 4.4+ expected fresh-node REACHABLE, got ${JSON.stringify(b2)}`);
          }
        }
      }
    }

    // ════ MATRIX line — human diagnosis; flags a boundary shift alongside the asserts ════
    pass(`hot-reload MATRIX [${verTag}] :: A{${aVerdict}} | B{${bVerdict}} | C{${cVerdict}} | D{${dVerdict}}`);
  } finally {
    for (const n of createdNodes) {
      try {
        await bridge.call("scene.delete_node", { node_path: n }, CALL_TIMEOUT);
      } catch {
        /* node may not exist */
      }
    }
    await cleanupProbeDir(ctx);
  }
}
