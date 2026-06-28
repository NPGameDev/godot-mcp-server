import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, assertGuard, unwrapUntrusted } from "../helpers.js";
import { isVersionAtLeast } from "../../src/shared/version.js";

export const TOOLS_TESTED: string[] = ["scene_create_node", "scene_delete_node", "animationtree_edit"];
export async function testAnimationTree(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  // ── Setup: create an AnimationTree node ──
  const treeNode = (await bridge.call(
    "scene.create_node",
    { class_name: "AnimationTree", parent_path: ".", node_name: "MCPSmokeAT" },
    CALL_TIMEOUT,
  )) as { status?: string; path?: string; code?: string };
  const treePath = treeNode?.path ?? "MCPSmokeAT";

  if (treeNode?.code) {
    fail(`animationtree setup: could not create AnimationTree: ${JSON.stringify(treeNode)}`);
    return;
  }

  // ── set_root: create state machine ──
  const setRootResult = (await bridge.call(
    "animationtree.edit",
    { node_path: treePath, action: "set_root", root_type: "AnimationNodeStateMachine" },
    CALL_TIMEOUT,
  )) as { success?: boolean; root_type?: string; code?: string };
  if (setRootResult?.success === true && setRootResult.root_type === "AnimationNodeStateMachine") {
    pass(`animationtree.edit set_root -> AnimationNodeStateMachine`);
  } else {
    fail(`animationtree.edit set_root: ${JSON.stringify(setRootResult)}`);
  }

  // ── add_node: idle ──
  const addIdle = (await bridge.call(
    "animationtree.edit",
    {
      node_path: treePath,
      action: "add_node",
      node_name: "idle",
      node_type: "AnimationNodeAnimation",
      animation_name: "idle",
      position: { x: 0, y: 0 },
    },
    CALL_TIMEOUT,
  )) as { success?: boolean; status?: string; node_name?: string; nodes_count?: number; code?: string };
  if (addIdle?.success === true && addIdle.status === "created" && addIdle.node_name === "idle") {
    pass(`animationtree.edit add_node idle -> created, nodes_count=${addIdle.nodes_count}`);
  } else {
    fail(`animationtree.edit add_node idle: ${JSON.stringify(addIdle)}`);
  }

  // ── add_node: run ──
  const addRun = (await bridge.call(
    "animationtree.edit",
    {
      node_path: treePath,
      action: "add_node",
      node_name: "run",
      node_type: "AnimationNodeAnimation",
      animation_name: "run",
      position: { x: 200, y: 0 },
    },
    CALL_TIMEOUT,
  )) as { success?: boolean; status?: string; nodes_count?: number; code?: string };
  if (addRun?.success === true && addRun.status === "created") {
    pass(`animationtree.edit add_node run -> created, nodes_count=${addRun.nodes_count}`);
  } else {
    fail(`animationtree.edit add_node run: ${JSON.stringify(addRun)}`);
  }

  // ── add_node: idempotent check ──
  const addIdleDup = (await bridge.call(
    "animationtree.edit",
    { node_path: treePath, action: "add_node", node_name: "idle", node_type: "AnimationNodeAnimation" },
    CALL_TIMEOUT,
  )) as { success?: boolean; status?: string; code?: string };
  if (addIdleDup?.success === true && addIdleDup.status === "returned") {
    pass(`animationtree.edit add_node idle idempotent -> returned`);
  } else {
    fail(`animationtree.edit add_node idle idempotent: ${JSON.stringify(addIdleDup)}`);
  }

  // ── add_transition: idle -> run with advance_condition ──
  const addTr1 = (await bridge.call(
    "animationtree.edit",
    {
      node_path: treePath,
      action: "add_transition",
      from: "idle",
      to: "run",
      switch_mode: "at_end",
      advance_condition: "is_running",
    },
    CALL_TIMEOUT,
  )) as { success?: boolean; status?: string; transitions_count?: number; code?: string };
  if (addTr1?.success === true && addTr1.status === "created") {
    pass(`animationtree.edit add_transition idle->run -> created, transitions_count=${addTr1.transitions_count}`);
  } else {
    fail(`animationtree.edit add_transition idle->run: ${JSON.stringify(addTr1)}`);
  }

  // ── add_transition: run -> idle with advance_mode auto ──
  const addTr2 = (await bridge.call(
    "animationtree.edit",
    {
      node_path: treePath,
      action: "add_transition",
      from: "run",
      to: "idle",
      advance_mode: "auto",
    },
    CALL_TIMEOUT,
  )) as { success?: boolean; status?: string; transitions_count?: number; code?: string };
  if (addTr2?.success === true && addTr2.status === "created") {
    pass(`animationtree.edit add_transition run->idle -> created, transitions_count=${addTr2.transitions_count}`);
  } else {
    fail(`animationtree.edit add_transition run->idle: ${JSON.stringify(addTr2)}`);
  }

  // ── list: verify structure ──
  const listResult = (await bridge.call(
    "animationtree.edit",
    { node_path: treePath, action: "list" },
    CALL_TIMEOUT,
  )) as { success?: boolean; root_type?: string; nodes?: unknown; transitions?: unknown; code?: string };
  if (listResult?.success === true && listResult.root_type === "AnimationNodeStateMachine") {
    pass(`animationtree.edit list -> root_type=${listResult.root_type}`);
  } else {
    fail(`animationtree.edit list: ${JSON.stringify(listResult)}`);
  }
  // Node enumeration uses AnimationNodeStateMachine.get_node_list(), a 4.5+ script API
  // Nodes are listed on 4.5+, empty on 4.2-4.4. Transitions enumerate on
  // all versions (get_transition_* are 4.2+), so list stays well-formed everywhere.
  const atVer = bridge.getGodotVersion();
  const listNodes = unwrapUntrusted(listResult?.nodes) as unknown[] | null;
  if (atVer != null && isVersionAtLeast(atVer, "4.5")) {
    if (Array.isArray(listNodes) && listNodes.length >= 2)
      pass(`animationtree.edit list nodes -> ${listNodes.length} (4.5+ enumerated)`);
    else fail(`animationtree.edit list nodes (4.5+): expected >=2, got ${JSON.stringify(listNodes)}`);
  } else {
    if (Array.isArray(listNodes) && listNodes.length === 0)
      pass(`animationtree.edit list nodes -> [] (4.2-4.4: get_node_list is 4.5+)`);
    else fail(`animationtree.edit list nodes (4.2-4.4): expected [], got ${JSON.stringify(listNodes)}`);
  }

  // ── remove_transition: run -> idle ──
  const removeTr = (await bridge.call(
    "animationtree.edit",
    { node_path: treePath, action: "remove_transition", from: "run", to: "idle" },
    CALL_TIMEOUT,
  )) as { success?: boolean; transitions_count?: number; code?: string };
  if (removeTr?.success === true && (removeTr.transitions_count ?? 0) === 1) {
    pass(`animationtree.edit remove_transition run->idle -> transitions_count=${removeTr.transitions_count}`);
  } else {
    fail(`animationtree.edit remove_transition run->idle: ${JSON.stringify(removeTr)}`);
  }

  // ── remove_node: run ──
  const removeRun = (await bridge.call(
    "animationtree.edit",
    { node_path: treePath, action: "remove_node", node_name: "run" },
    CALL_TIMEOUT,
  )) as { success?: boolean; nodes_count?: number; code?: string };
  if (removeRun?.success === true) {
    pass(`animationtree.edit remove_node run -> nodes_count=${removeRun.nodes_count}`);
  } else {
    fail(`animationtree.edit remove_node run: ${JSON.stringify(removeRun)}`);
  }

  // ── Guard: non-AnimationTree node → INVALID_CLASS ──
  const spriteNode = (await bridge.call(
    "scene.create_node",
    { class_name: "Sprite2D", parent_path: ".", node_name: "MCPSmokeATSprite" },
    CALL_TIMEOUT,
  )) as { path?: string };
  const spritePath = spriteNode?.path ?? "MCPSmokeATSprite";

  assertGuard(
    ctx,
    "animationtree.edit non-AnimationTree",
    await bridge.call("animationtree.edit", { node_path: spritePath, action: "list" }, CALL_TIMEOUT),
    "INVALID_CLASS",
    "AnimationTree",
  );

  // ── Guard: remove_node not found → NOT_FOUND ──
  assertGuard(
    ctx,
    "animationtree.edit remove_node not found",
    await bridge.call(
      "animationtree.edit",
      { node_path: treePath, action: "remove_node", node_name: "no_such_node" },
      CALL_TIMEOUT,
    ),
    "NOT_FOUND",
    "no_such_node",
  );

  // ── Guard: add_transition with missing node → NOT_FOUND ──
  assertGuard(
    ctx,
    "animationtree.edit add_transition missing from",
    await bridge.call(
      "animationtree.edit",
      { node_path: treePath, action: "add_transition", from: "no_exist", to: "idle" },
      CALL_TIMEOUT,
    ),
    "NOT_FOUND",
    "no_exist",
  );

  // ── Cleanup ──
  try {
    await bridge.call("scene.delete_node", { node_path: spritePath }, CALL_TIMEOUT);
  } catch {
    /* noop */
  }
  try {
    await bridge.call("scene.delete_node", { node_path: treePath }, CALL_TIMEOUT);
  } catch {
    /* noop */
  }
}
