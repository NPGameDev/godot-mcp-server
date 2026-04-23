// ═══════════════════════════════════════════════════════════════════════════
// Correctness Eval 01 — Scene Creation Workflow
//
// Creates a scene with a specific node hierarchy (root → children →
// properties), reads it back, and verifies structural accuracy.
// ═══════════════════════════════════════════════════════════════════════════

import type { EvalScenario, EvalBridge } from "../eval-runner.js";
import type { AssertionResult, ScenarioResult } from "../eval-report.js";
import { CALL_TIMEOUT, unwrapUntrusted } from "../../helpers.js";

const SCENE_PATH = "res://eval_scene_creation.tscn";
const CALL_MS = CALL_TIMEOUT;

export const sceneCreation: EvalScenario = {
  name: "scene-creation-workflow",
  dimension: "correctness",

  async run(bridge: EvalBridge): Promise<ScenarioResult> {
    const assertions: AssertionResult[] = [];
    let toolCalls = 0;
    const start = Date.now();

    const call = async (method: string, params?: unknown): Promise<unknown> => {
      toolCalls++;
      return bridge.call(method, params, CALL_MS);
    };

    // ── Setup: create a fresh scene ──────────────────────────────────────
    const createScene = (await call("scene.create", {
      file_path: SCENE_PATH,
      root_type: "Node3D",
      if_exists: "replace",
    })) as { status?: string; path?: string };

    assertions.push({
      label: "scene.create succeeds",
      passed: createScene?.status === "created" || createScene?.status === "replaced",
      detail: createScene?.status,
    });

    // Open the scene so node operations target it
    await call("scene.open", { file_path: SCENE_PATH });

    // ── Build hierarchy: root → Camera3D, CharacterBody3D → CollisionShape3D ─
    const cam = (await call("scene.create_node", {
      class_name: "Camera3D",
      parent_path: ".",
      node_name: "MainCamera",
    })) as { path?: string; status?: string };

    assertions.push({
      label: "create Camera3D child",
      passed: cam?.status === "created" && typeof cam.path === "string",
      detail: cam?.path,
    });

    const body = (await call("scene.create_node", {
      class_name: "CharacterBody3D",
      parent_path: ".",
      node_name: "Player",
    })) as { path?: string; status?: string };

    assertions.push({
      label: "create CharacterBody3D child",
      passed: body?.status === "created" && typeof body.path === "string",
      detail: body?.path,
    });

    const collision = (await call("scene.create_node", {
      class_name: "CollisionShape3D",
      parent_path: "Player",
      node_name: "PlayerCollision",
    })) as { path?: string; status?: string };

    assertions.push({
      label: "create CollisionShape3D grandchild",
      passed: collision?.status === "created" && typeof collision.path === "string",
      detail: collision?.path,
    });

    // ── Set properties ───────────────────────────────────────────────────
    const setCamFov = (await call("node.set_property", {
      node_path: "MainCamera",
      property: "fov",
      value: 90,
    })) as { ok?: boolean };

    assertions.push({
      label: "set Camera3D.fov = 90",
      passed: setCamFov?.ok === true,
    });

    const setBodyDesc = (await call("node.set_property", {
      node_path: "Player",
      property: "editor_description",
      value: "eval-player-marker",
    })) as { ok?: boolean };

    assertions.push({
      label: "set CharacterBody3D.editor_description",
      passed: setBodyDesc?.ok === true,
    });

    // ── Read back and verify ─────────────────────────────────────────────
    const tree = (await call("scene.get_tree", {})) as { tree?: string; name?: string; children?: unknown[] };
    const parsed = (tree?.tree ? unwrapUntrusted(tree.tree) : tree) as {
      name?: string;
      class?: string;
      children?: { name?: string; class?: string; children?: { name?: string; class?: string }[] }[];
    };

    assertions.push({
      label: "scene root is Node3D",
      passed: parsed?.class === "Node3D",
      detail: parsed?.class,
    });

    const camChild = parsed?.children?.find((c) => c.name === "MainCamera");
    assertions.push({
      label: "MainCamera child present",
      passed: camChild?.class === "Camera3D",
      detail: camChild?.class,
    });

    const playerChild = parsed?.children?.find((c) => c.name === "Player");
    assertions.push({
      label: "Player child present",
      passed: playerChild?.class === "CharacterBody3D",
      detail: playerChild?.class,
    });

    const collisionGrandchild = playerChild?.children?.find((c) => c.name === "PlayerCollision");
    assertions.push({
      label: "PlayerCollision grandchild present",
      passed: collisionGrandchild?.class === "CollisionShape3D",
      detail: collisionGrandchild?.class,
    });

    // Verify property was set correctly
    const getFov = (await call("node.get_property", {
      node_path: "MainCamera",
      property: "fov",
    })) as { value?: unknown };

    assertions.push({
      label: "Camera3D.fov reads back as 90",
      passed: getFov?.value === 90,
      detail: String(getFov?.value),
    });

    const getDesc = (await call("node.get_property", {
      node_path: "Player",
      property: "editor_description",
    })) as { value?: unknown };

    assertions.push({
      label: "Player.editor_description reads back correctly",
      passed: getDesc?.value === "eval-player-marker",
      detail: String(getDesc?.value),
    });

    // ── Teardown (uses asset_management group tools) ────────────────────
    await call("scene.close", { file_path: SCENE_PATH });
    await call("scene.open", { file_path: "res://Main.tscn" });
    await call("scene.delete", { file_path: SCENE_PATH });

    return {
      name: sceneCreation.name,
      dimension: "correctness",
      assertions,
      toolCalls,
      groupsNeeded: ["asset_management"],
      durationMs: Date.now() - start,
    };
  },
};
