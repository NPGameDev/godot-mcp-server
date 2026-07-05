import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT } from "../helpers.js";

// ═══════════════════════════════════════════════════════════════════════════
// Batch partial-failure visibility.
//
// The toolkit's shared `summarize_batch` helper (editor_helpers.gd) rolls a
// per-entry results[] up into a top-level partial-failure summary so a caller
// that reads only the top of the response still sees that some entries failed:
//   - ADDS `failed` (int count) + `hint` (String) when >=1 entry failed.
//   - leaves the response UNCHANGED (no keys added) when every entry succeeded
//     (the additive-only guarantee — an all-success batch is byte-identical).
//
// Wired into the 2 results[]-bearing batch tools (T:eb25de5, T:42e5b87):
//   - node.set_property batch → _batch_set_properties (per-entry {success:bool})
//   - node.groups       batch → _batch_node_groups    (per-entry {status?,error?},
//                                                       NO `success` key — the
//                                                       helper's tolerant
//                                                       predicate still counts it)
//
// These were the two "GAP: batch mode" rows in SMOKE-COVERAGE-MANIFEST.md.
// Each tool gets a one-bad-entry case (asserts failed/hint present + correct)
// plus an all-success control (asserts failed/hint ABSENT — locks additivity).
//
// scene.instantiate is the third results[]-bearing batch site: D-C3 (T:7244950)
// wired the same `summarize_batch` rollup into `_batch_instantiate`
// (scene_commands.gd:708). Only one path increments top-level `failed` —
// `packed.instantiate() == null` (scene_commands.gd:625-628) — and all entries
// share ONE already-validated PackedScene, so a per-entry instantiate failure is
// NOT triggerable through the MCP surface from a valid .tscn (a bad scene fails
// the whole call at LOAD_FAILED/NOT_FOUND before the batch loop; the
// `instance==null` path is defensive). Per-key coerce errors attach as
// `property_errors[]` to a SUCCEEDING entry — they do not fail it. So the
// scene.instantiate partial-failure rollup is pinned at the helper level by the
// toolkit headless unit `_test_summarize_batch` (which feeds it a {success:false}
// shape), and smoke asserts only the all-success scene.instantiate batch control
// below — locking the additive-only guarantee for site-3 end-to-end.
// ═══════════════════════════════════════════════════════════════════════════

const EXPECTED_HINT_NEEDLE = "inspect results[]";

export const TOOLS_TESTED: string[] = ["node_set_property", "node_groups", "scene_instantiate"];

type BatchResult = {
  success?: boolean;
  failed?: number;
  hint?: string;
  results?: Array<Record<string, unknown>>;
  count?: number;
  instances?: Array<Record<string, unknown>>;
  status?: string;
  action?: string;
  code?: string;
  error?: string;
};

export async function testBatchPartialFailure(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  // Precondition: an edited scene must be open.
  const tree = (await bridge.call("scene.get_tree", null, CALL_TIMEOUT)) as { code?: string };
  if (tree && tree.code === "NO_SCENE") {
    fail("scene.get_tree: NO_SCENE — open Main.tscn in the Godot editor before running smoke");
    return;
  }

  // Probe node we own end-to-end. A Node2D gives us safe scalar props
  // (rotation/visible) to set. We never set editor_description on it, so the
  // SceneTreeEditor tooltip-timer UAF (Godot 4.3+) is not in play — it is safe
  // to delete during cleanup.
  const probe = "BatchPartialFailProbe";
  // Child-scene fixture for the scene.instantiate all-success control (job 2).
  const instFixture = "res://smoke_batch_inst_child.tscn";
  // Orphan cleanup from a prior aborted run.
  try {
    await bridge.call("scene.delete_node", { node_path: probe }, CALL_TIMEOUT);
  } catch {
    /* noop */
  }
  for (const orphan of ["BatchInstA", "BatchInstB"]) {
    try {
      await bridge.call("scene.delete_node", { node_path: orphan }, CALL_TIMEOUT);
    } catch {
      /* noop */
    }
  }
  try {
    await bridge.call("scene.delete", { file_path: instFixture }, CALL_TIMEOUT);
  } catch {
    /* noop */
  }
  const created = (await bridge.call(
    "scene.create_node",
    { class_name: "Node2D", parent_path: ".", node_name: probe },
    CALL_TIMEOUT,
  )) as { status?: string; path?: string; code?: string };
  if (created?.status !== "created" && created?.status !== "returned") {
    fail(`scene.create_node ${probe}: ${JSON.stringify(created)}`);
    return;
  }
  const probePath = created.path ?? probe;

  try {
    // ── node.set_property batch — one bad entry (node not found) ──
    // entries[0] sets rotation on the real probe (success:true);
    // entries[1] targets a nonexistent node → {success:false, error:"node not
    // found"}. Top-level summary must surface failed=1 + a hint.
    const setBatchPartial = (await bridge.call(
      "node.set_property",
      {
        batch: [
          { node_path: probePath, property: "rotation", value: 1.5 },
          { node_path: "NoSuchNode_batch_xyz", property: "rotation", value: 1.5 },
        ],
      },
      CALL_TIMEOUT,
    )) as BatchResult;
    if (setBatchPartial?.success !== true) {
      fail(
        `node.set_property batch partial-fail: expected success:true envelope, got ${JSON.stringify(setBatchPartial)}`,
      );
    } else if (setBatchPartial.failed !== 1) {
      fail(
        `node.set_property batch partial-fail: expected top-level failed=1, got ${JSON.stringify({
          failed: setBatchPartial.failed,
          results: setBatchPartial.results,
        })}`,
      );
    } else if (typeof setBatchPartial.hint !== "string" || !setBatchPartial.hint.includes(EXPECTED_HINT_NEEDLE)) {
      fail(
        `node.set_property batch partial-fail: expected hint containing "${EXPECTED_HINT_NEEDLE}", got ${JSON.stringify(setBatchPartial.hint)}`,
      );
    } else if (!setBatchPartial.hint.includes("1 of 2 entries failed")) {
      fail(
        `node.set_property batch partial-fail: hint should report "1 of 2 entries failed", got "${setBatchPartial.hint}"`,
      );
    } else {
      pass(`node.set_property batch partial-fail -> failed=1 + hint ("${setBatchPartial.hint.slice(0, 56)}...")`);
    }

    // ── node.set_property batch — all-success control (additive guarantee) ──
    // Two valid entries on the probe → no entry fails → the summary must add
    // NOTHING: failed + hint absent. Locks "additive-only / byte-identical on
    // all-success".
    const setBatchAllOk = (await bridge.call(
      "node.set_property",
      {
        batch: [
          { node_path: probePath, property: "rotation", value: 0.5 },
          { node_path: probePath, property: "visible", value: false },
        ],
      },
      CALL_TIMEOUT,
    )) as BatchResult;
    if (setBatchAllOk?.success !== true) {
      fail(`node.set_property batch all-success: expected success:true envelope, got ${JSON.stringify(setBatchAllOk)}`);
    } else if (setBatchAllOk.failed !== undefined || setBatchAllOk.hint !== undefined) {
      fail(
        `node.set_property batch all-success: expected NO failed/hint keys (additive-only), got ${JSON.stringify({
          failed: setBatchAllOk.failed,
          hint: setBatchAllOk.hint,
        })}`,
      );
    } else {
      pass(`node.set_property batch all-success -> failed/hint absent (additive-only)`);
    }

    // ── node.groups batch — one not-found entry ──
    // node.groups batch entries carry {status?, error?} with NO `success` key;
    // the helper's tolerant predicate (no-success + error => failure) must still
    // count the not-found entry. entries[0] adds the probe to a group
    // (status:"added"); entries[1] targets a nonexistent node → {error:"node
    // not found"}. Top-level summary must surface failed=1 + a hint.
    const groupsBatchPartial = (await bridge.call(
      "node.groups",
      {
        action: "add",
        entries: [
          { node_path: probePath, group: "smoke_batch_grp" },
          { node_path: "NoSuchNode_batch_xyz", group: "smoke_batch_grp" },
        ],
      },
      CALL_TIMEOUT,
    )) as BatchResult;
    if (groupsBatchPartial?.success !== true) {
      fail(`node.groups batch partial-fail: expected success:true envelope, got ${JSON.stringify(groupsBatchPartial)}`);
    } else if (groupsBatchPartial.failed !== 1) {
      fail(
        `node.groups batch partial-fail: expected top-level failed=1 (tolerant predicate on {status?,error?} entries), got ${JSON.stringify(
          { failed: groupsBatchPartial.failed, results: groupsBatchPartial.results },
        )}`,
      );
    } else if (typeof groupsBatchPartial.hint !== "string" || !groupsBatchPartial.hint.includes(EXPECTED_HINT_NEEDLE)) {
      fail(
        `node.groups batch partial-fail: expected hint containing "${EXPECTED_HINT_NEEDLE}", got ${JSON.stringify(groupsBatchPartial.hint)}`,
      );
    } else if (!groupsBatchPartial.hint.includes("1 of 2 entries failed")) {
      fail(
        `node.groups batch partial-fail: hint should report "1 of 2 entries failed", got "${groupsBatchPartial.hint}"`,
      );
    } else {
      pass(`node.groups batch partial-fail -> failed=1 + hint (tolerant predicate, no per-entry success key)`);
    }

    // ── node.groups batch — all-success control (additive guarantee) ──
    const groupsBatchAllOk = (await bridge.call(
      "node.groups",
      {
        action: "add",
        entries: [{ node_path: probePath, group: "smoke_batch_grp2" }],
      },
      CALL_TIMEOUT,
    )) as BatchResult;
    if (groupsBatchAllOk?.success !== true) {
      fail(`node.groups batch all-success: expected success:true envelope, got ${JSON.stringify(groupsBatchAllOk)}`);
    } else if (groupsBatchAllOk.failed !== undefined || groupsBatchAllOk.hint !== undefined) {
      fail(
        `node.groups batch all-success: expected NO failed/hint keys (additive-only), got ${JSON.stringify({
          failed: groupsBatchAllOk.failed,
          hint: groupsBatchAllOk.hint,
        })}`,
      );
    } else {
      pass(`node.groups batch all-success -> failed/hint absent (additive-only)`);
    }

    // ── scene.instantiate batch — all-success control (site-3 additivity) ──
    // The third results[]-bearing batch site. A per-entry instantiate failure is
    // not reachable from a valid .tscn (one shared PackedScene; the `instance==null`
    // path is defensive — pinned by the toolkit headless unit _test_summarize_batch),
    // so smoke locks only the all-success guarantee end-to-end: 2 valid entries →
    // count/instances reflect 2 created nodes and the summary adds NOTHING
    // (failed + hint absent). Reuses §10's child-scene fixture idiom: a Node2D-root
    // .tscn instantiated under the currently-open scene root (".") — same parent the
    // probe above uses.
    const sceneCreated = (await bridge.call(
      "scene.create",
      { file_path: instFixture, root_type: "Node2D" },
      CALL_TIMEOUT,
    )) as { status?: string; code?: string };
    if (sceneCreated?.status !== "created") {
      fail(`scene.instantiate batch all-success: fixture scene.create failed: ${JSON.stringify(sceneCreated)}`);
    } else {
      const instBatchAllOk = (await bridge.call(
        "scene.instantiate",
        {
          parent_path: ".",
          scene_path: instFixture,
          instances: [
            { name: "BatchInstA", position: { type: "Vector2", x: 16, y: 32 } },
            { name: "BatchInstB", position: { type: "Vector2", x: 48, y: 64 } },
          ],
        },
        CALL_TIMEOUT,
      )) as BatchResult;
      if (instBatchAllOk?.success !== true) {
        fail(
          `scene.instantiate batch all-success: expected success:true envelope, got ${JSON.stringify(instBatchAllOk)}`,
        );
      } else if (instBatchAllOk.count !== 2 || (instBatchAllOk.instances?.length ?? -1) !== 2) {
        fail(
          `scene.instantiate batch all-success: expected count=2 and instances.length=2, got ${JSON.stringify({
            count: instBatchAllOk.count,
            instances: instBatchAllOk.instances,
          })}`,
        );
      } else if (instBatchAllOk.failed !== undefined || instBatchAllOk.hint !== undefined) {
        fail(
          `scene.instantiate batch all-success: expected NO failed/hint keys (additive-only), got ${JSON.stringify({
            failed: instBatchAllOk.failed,
            hint: instBatchAllOk.hint,
          })}`,
        );
      } else {
        pass(`scene.instantiate batch all-success -> count=2, instances=2, failed/hint absent (additive-only)`);
      }
      // Delete the two spawned nodes by their resolved paths (fall back to the
      // requested names if the response omitted a path).
      for (const inst of instBatchAllOk.instances ?? []) {
        const nodePath = (inst as { path?: string; name?: string }).path ?? (inst as { name?: string }).name;
        if (typeof nodePath === "string" && nodePath.length > 0) {
          try {
            await bridge.call("scene.delete_node", { node_path: nodePath }, CALL_TIMEOUT);
          } catch {
            /* noop */
          }
        }
      }
      // Belt-and-suspenders: also clear the requested names in case nothing was created.
      for (const name of ["BatchInstA", "BatchInstB"]) {
        try {
          await bridge.call("scene.delete_node", { node_path: name }, CALL_TIMEOUT);
        } catch {
          /* noop */
        }
      }
    }
  } finally {
    // Self-cleanup: delete the probe (carries the test groups but is removed
    // wholesale, so no group state lingers).
    try {
      await bridge.call("scene.delete_node", { node_path: probePath }, CALL_TIMEOUT);
    } catch {
      /* noop */
    }
    // Remove the scene.instantiate fixture file.
    try {
      await bridge.call("scene.delete", { file_path: instFixture }, CALL_TIMEOUT);
    } catch {
      /* noop */
    }
  }
}
