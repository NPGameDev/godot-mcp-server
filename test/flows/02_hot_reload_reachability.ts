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
// A toolkit write reloads the script the editor has cached when the new source
// compiles, so through script.write the live instance runs the edit on every version.
// A file changed OUTSIDE the toolkit is reloaded by the engine alone only on a 4.4+
// display editor's scan; there the stale-instance hints apply. The boundary is 4.3 → 4.4:
//
//   Scenario               | < 4.4 (4.2, 4.3)          | 4.4+ headless       | 4.4+ display
//   -----------------------|---------------------------|---------------------|------------------
//   A added method (write) | REACHABLE                 | REACHABLE           | REACHABLE
//   B body edit (write)    | NEW value                 | NEW value           | NEW value
//   C compile error        | valid:false + diagnostics on every version. Where the engine does
//                          | not reload the written file itself (< 4.4; 4.5+ headless), the
//                          | live node keeps the valid version and node.set_script refuses the
//                          | file (valid:false + hint). Where it does (4.4+ display; 4.4
//                          | headless), its reload decides the live node (recorded, not asserted)
//   D fresh node           | REACHABLE                 | REACHABLE           | REACHABLE
//   E outside edit         | STALE + stale hint        | STALE + headless    | REACHABLE or STALE
//                          |                           | stale hint          | (focus-scan race)
//
// node.set_script reloads a script whose file changed, so setting the script again
// recovers on every version, on the same node (A's and E's rebind) or a fresh one (D).
// The reactive stale-instance hint: node.call_method → INVALID_METHOD carries it when
// the method exists on the on-disk .gd but not the live instance (< 4.4, and 4.4+
// headless); a genuine typo (method absent on disk) gets NO stale hint. No script.write
// response carries a stale hint.
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

// Distinctive substring of the < 4.4 stale-instance hint (the reactive
// recovery_message).
const STALE_MARKER = "keeps the OLD code";

// The 4.4+ HEADLESS reactive hint uses distinct wording — a headless editor never
// re-instantiates a live node, a different hazard from the < 4.4 engine-cache staleness —
// with NO "keeps the OLD code" phrase, so it needs its own marker. See the toolkit's
// stale_instance_hint.gd `_RECOVERY_HEADLESS`.
const HEADLESS_STALE_MARKER = "don't re-instantiate live nodes";

// Distinctive substring of node.set_script's hint when the compile gate refuses the file.
const REFUSED_MARKER = "was not loaded";

const A_SCRIPT = `${FLOW_PROBE_DIR}/flow_hot_probe.gd`;
const B_SCRIPT = `${FLOW_PROBE_DIR}/flow_body_probe.gd`;
const C_SCRIPT = `${FLOW_PROBE_DIR}/flow_compile_probe.gd`;
const D_SCRIPT = `${FLOW_PROBE_DIR}/flow_fresh_probe.gd`;
const E_SCRIPT = `${FLOW_PROBE_DIR}/flow_outside_probe.gd`;
const E_WRITER_SCRIPT = `${FLOW_PROBE_DIR}/flow_disk_writer.gd`;

const A_NODE = "FlowHotProbe";
const B_NODE = "FlowBodyProbe";
const C_NODE = "FlowCompileProbe";
const D_NODE1 = "FlowFreshProbe1";
const D_NODE2 = "FlowFreshProbe2";
const E_NODE = "FlowOutsideProbe";
const E_WRITER_NODE = "FlowDiskWriter";

const A_V1 = `@tool\nextends Node\n\nfunc flow_marker() -> String:\n\treturn "v1"\n`;
const A_V2 = `@tool\nextends Node\n\nfunc flow_marker() -> String:\n\treturn "v1"\n\nfunc flow_added_method() -> String:\n\treturn "added"\n`;
const B_V1 = `@tool\nextends Node\n\nfunc flow_body() -> String:\n\treturn "b1"\n`;
const B_V2 = `@tool\nextends Node\n\nfunc flow_body() -> String:\n\treturn "b2"\n`;
const C_VALID = `@tool\nextends Node\n\nfunc flow_ok() -> int:\n\treturn 1\n`;
const C_BROKEN = `@tool\nextends Node\n\nfunc flow_ok() -> int:\n\treturn 1\n\nvar = = =\n`;
const D_V1 = `@tool\nextends Node\n\nfunc fresh_a() -> String:\n\treturn "a"\n`;
const D_V2 = `@tool\nextends Node\n\nfunc fresh_a() -> String:\n\treturn "a"\n\nfunc fresh_b() -> String:\n\treturn "b"\n`;
const E_V1 = `@tool\nextends Node\n\nfunc outside_a() -> String:\n\treturn "a"\n`;
const E_V2 = `@tool\nextends Node\n\nfunc outside_a() -> String:\n\treturn "a"\n\nfunc outside_b() -> String:\n\treturn "b"\n`;
// Writes a file with FileAccess, the way an external editor would: no toolkit write path,
// so nothing reloads the cached script.
const E_WRITER = `@tool\nextends Node\n\nfunc write_text(path: String, text: String) -> bool:\n\tvar file := FileAccess.open(path, FileAccess.WRITE)\n\tif file == null:\n\t\treturn false\n\tfile.store_string(text)\n\tfile.close()\n\treturn true\n`;

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
interface SetScriptResult {
  success?: boolean;
  valid?: boolean;
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
async function setScript(ctx: TestCtx, nodePath: string, scriptPath: string): Promise<SetScriptResult> {
  return (await ctx.bridge.call(
    "node.set_script",
    { node_path: nodePath, script_path: scriptPath },
    CALL_TIMEOUT,
  )) as SetScriptResult;
}
async function attach(ctx: TestCtx, nodePath: string, scriptPath: string): Promise<boolean> {
  return (await setScript(ctx, nodePath, scriptPath))?.success === true;
}
async function callMethod(ctx: TestCtx, nodePath: string, method: string, args: unknown[] = []): Promise<CallResult> {
  return (await ctx.bridge.call(
    "node.call_method",
    { node_path: nodePath, method_name: method, args },
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
  // Editor display mode from the auth handshake (resolved by the calls above). It matters
  // only for scenario E, the file changed outside the toolkit: a 4.4+ display editor may
  // reload it on a focus scan (a race), a 4.4+ headless one never does, and < 4.4
  // (pre-NodeCache) never does in either mode.
  const headless = bridge.isHeadless() === true;
  const verTag = `${ver} ${pre44 ? "(<4.4)" : headless ? "(4.4+ headless)" : "(4.4+ display)"}`;
  const createdNodes: string[] = [];
  let aVerdict = "?";
  let bVerdict = "?";
  let cVerdict = "?";
  let dVerdict = "?";
  let eVerdict = "?";

  try {
    // ════ Scenario A — add a NEW method, call on the SAME live instance ════
    const aCreate = await writeScript(ctx, A_SCRIPT, A_V1);
    if (aCreate?.success !== true) {
      fail(`A SETUP: script.write v1 failed: ${JSON.stringify(aCreate)}`);
    } else {
      // A create carries NO stale hint.
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

          // Edit: add flow_added_method (compiles); the write reloads the cached script.
          const aEdit = await writeScript(ctx, A_SCRIPT, A_V2);
          if (aEdit?.success !== true) {
            fail(`A EDIT: script.write v2 failed: ${JSON.stringify(aEdit)}`);
          } else {
            if (!hasStaleHint(aEdit)) pass(`A: existing-edit write has NO stale hint on ${verTag}`);
            else fail(`A: existing-edit write wrongly carried a stale hint on ${verTag}: ${aEdit.hint}`);

            // The write reloaded the cached script, so the live instance has the new method.
            const after = await callMethod(ctx, node, "flow_added_method");
            aVerdict = after?.success === true ? "REACHABLE" : `STALE(${after?.code ?? "?"})`;
            if (after?.success === true && after.result === "added")
              pass(`A: added-method REACHABLE after the write on ${verTag}`);
            else fail(`A: expected REACHABLE "added" on ${verTag}, got ${JSON.stringify(after)}`);

            // A refresh and a rebind keep it reachable (regression guard).
            await refresh(ctx);
            await settleScan(ctx);
            const afterRefresh = await callMethod(ctx, node, "flow_added_method");
            await attach(ctx, node, A_SCRIPT);
            const afterRebind = await callMethod(ctx, node, "flow_added_method");
            if (afterRefresh?.success === true && afterRebind?.success === true)
              pass(`A: reachable through refresh + rebind on ${verTag}`);
            else
              fail(`A recovery mismatch on ${verTag}: refresh=${afterRefresh?.success} rebind=${afterRebind?.success}`);
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
        // The write reloaded the cached script, so the live instance runs the new body.
        const after = await callMethod(ctx, node, "flow_body");
        bVerdict = after?.success === true ? String(after.result) : `ERR(${after?.code ?? "?"})`;
        if (after?.success === true && after.result === "b2") pass(`B: body-edit live -> "b2" on ${verTag}`);
        else fail(`B: expected "b2" on ${verTag}, got ${JSON.stringify(after)}`);
      }
    }

    // ════ Scenario C — the (re)write introduces a COMPILE ERROR ════
    {
      const wOk = await writeScript(ctx, C_SCRIPT, C_VALID);
      await settleScan(ctx);
      const cNode = await makeNode(ctx, C_NODE);
      if (cNode) {
        createdNodes.push(cNode);
        await attach(ctx, cNode, C_SCRIPT);
      } else fail(`C SETUP: scene.create_node failed`);
      const wBad = await writeScript(ctx, C_SCRIPT, C_BROKEN); // existing-edit that does NOT compile
      // The toolkit never reloads a source that does not compile. On 4.4+ the editor's own
      // update of the written file reloads the cached script in place with the broken source
      // (Script::reload_from_file → a CACHE_MODE_IGNORE load → GDScriptCache::get_full_script),
      // except on a 4.5+ headless editor, which skips that step in command-line mode. Only where
      // the engine leaves the script alone does the toolkit's gate decide, so only there is the
      // outcome asserted; elsewhere it is recorded in the MATRIX line.
      const engineReloadsWrite = !pre44 && !(headless && isVersionAtLeast(verPair, "4.5"));
      let liveVerdict = "?";
      if (cNode) {
        const live = await callMethod(ctx, cNode, "flow_ok");
        liveVerdict = live?.success === true ? String(live.result) : `ERR(${live?.code ?? "?"})`;
        const reSet = await setScript(ctx, cNode, C_SCRIPT);
        const refused =
          reSet?.success === true && reSet.valid === false && reSet.hint?.includes(REFUSED_MARKER) === true;
        const afterReSet = await callMethod(ctx, cNode, "flow_ok");
        liveVerdict += ` refused=${refused} afterSet=${afterReSet?.success === true ? String(afterReSet.result) : `ERR(${afterReSet?.code ?? "?"})`}`;
        if (!engineReloadsWrite) {
          if (live?.success === true && live.result === 1)
            pass(`C: live node keeps the valid version after the broken write on ${verTag}`);
          else fail(`C: expected flow_ok() -> 1 after the broken write on ${verTag}, got ${JSON.stringify(live)}`);
          if (refused) pass(`C: node.set_script refuses the broken file (valid:false + hint) on ${verTag}`);
          else
            fail(
              `C: node.set_script expected valid:false + "${REFUSED_MARKER}" hint on ${verTag}, got ${JSON.stringify(reSet)}`,
            );
          if (afterReSet?.success === true && afterReSet.result === 1)
            pass(`C: the node keeps the valid version after the refused set on ${verTag}`);
          else fail(`C: expected flow_ok() -> 1 after the refused set on ${verTag}, got ${JSON.stringify(afterReSet)}`);
        }
      }
      if (wOk?.success !== true || wBad?.success !== true) {
        fail(`C SETUP: script.write did not return success: ${JSON.stringify({ wOk, wBad })}`);
      } else {
        const okValid = wOk.valid === true;
        const badInvalid = wBad.valid === false;
        const hasDiag = Array.isArray(wBad.diagnostics) && wBad.diagnostics.length > 0;
        cVerdict = `okValid=${okValid} badInvalid=${badInvalid} diag=${hasDiag} live=${liveVerdict}`;
        if (okValid && badInvalid && hasDiag) pass(`C: compile-gate signal present (${cVerdict})`);
        else fail(`C: compile-gate ANOMALY (${cVerdict})`);
        // A compile-FAILED existing-edit carries NO stale hint: the diagnostics are the
        // right signal.
        if (!hasStaleHint(wBad)) pass(`C: compile-failed write carries no stale hint`);
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
          // Every version: node.set_script reloads the changed script, so the fresh node runs the
          // edit and the old method still works.
          if (b2?.success === true && b2.result === "b") pass(`D: FRESH node REACHABLE on ${verTag}`);
          else fail(`D: expected fresh-node REACHABLE on ${verTag}, got ${JSON.stringify(b2)}`);
          const a2 = await callMethod(ctx, node2, "fresh_a");
          if (a2?.success === true && a2.result === "a") pass(`D: fresh node2 keeps the old method`);
          else fail(`D: fresh node2 could not call fresh_a — attach failed? ${JSON.stringify(a2)}`);
        }
      }
    }

    // ════ Scenario E — a file changed OUTSIDE the toolkit: the reactive stale hint ════
    {
      await writeScript(ctx, E_SCRIPT, E_V1);
      await writeScript(ctx, E_WRITER_SCRIPT, E_WRITER);
      await settleScan(ctx);
      const node = await makeNode(ctx, E_NODE);
      const writer = await makeNode(ctx, E_WRITER_NODE);
      if (node) createdNodes.push(node);
      if (writer) createdNodes.push(writer);
      if (!node || !writer || !(await attach(ctx, node, E_SCRIPT)) || !(await attach(ctx, writer, E_WRITER_SCRIPT))) {
        fail(`E SETUP: could not create and attach the probe and writer nodes`);
      } else {
        const a1 = await callMethod(ctx, node, "outside_a");
        if (a1?.success === true && a1.result === "a") pass(`E invariant: live outside_a() -> a`);
        else fail(`E invariant: outside_a expected "a", got ${JSON.stringify(a1)}`);

        const wrote = await callMethod(ctx, writer, "write_text", [E_SCRIPT, E_V2]);
        if (wrote?.success !== true || wrote.result !== true) {
          fail(`E SETUP: the outside write failed: ${JSON.stringify(wrote)}`);
        } else {
          // No toolkit write ran, so nothing reloaded the cached script.
          const after = await callMethod(ctx, node, "outside_b");
          eVerdict = after?.success === true ? "REACHABLE" : `STALE(${after?.code ?? "?"})`;
          const stale = after?.success === false && after.code === "INVALID_METHOD";
          if (pre44) {
            if (stale && hasStaleHint(after)) pass(`E: <4.4 outside edit STALE + reactive stale hint`);
            else fail(`E: <4.4 expected STALE + stale hint, got ${JSON.stringify(after)}`);
          } else if (headless) {
            if (stale && hasHeadlessStaleHint(after))
              pass(`E: 4.4+ headless outside edit STALE + headless re-instantiation hint`);
            else fail(`E: 4.4+ headless expected STALE + headless hint, got ${JSON.stringify(after)}`);
          } else {
            // 4.4+ display: a focus scan may already have reloaded the file (a race). The toolkit
            // sends no stale hint on a 4.4+ display editor, so a STALE call carries none.
            if (after?.success === true) pass(`E: 4.4+ display outside edit REACHABLE`);
            else if (stale && !hasStaleHint(after) && !hasHeadlessStaleHint(after))
              pass(`E: 4.4+ display outside edit STALE with no stale hint`);
            else
              fail(`E: 4.4+ display expected REACHABLE or INVALID_METHOD w/o stale hint, got ${JSON.stringify(after)}`);
          }

          // Setting the script again reloads the changed file on every version.
          await attach(ctx, node, E_SCRIPT);
          const afterRebind = await callMethod(ctx, node, "outside_b");
          if (afterRebind?.success === true && afterRebind.result === "b")
            pass(`E: re-set_script recovers the outside edit on ${verTag}`);
          else fail(`E: expected re-set_script to recover outside_b() -> b, got ${JSON.stringify(afterRebind)}`);
        }
      }
    }

    // ════ MATRIX line — human diagnosis; flags a boundary shift alongside the asserts ════
    pass(
      `hot-reload MATRIX [${verTag}] :: A{${aVerdict}} | B{${bVerdict}} | C{${cVerdict}} | D{${dVerdict}} | E{${eVerdict}}`,
    );
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
