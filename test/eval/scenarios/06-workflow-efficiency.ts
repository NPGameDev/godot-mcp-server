// ═══════════════════════════════════════════════════════════════════════════
// Efficiency Eval 06 — Multi-step Workflow Efficiency
//
// Scripted multi-step workflows that measure tool-call counts against
// known optimal sequences. Each workflow runs the optimal path and
// records how many calls it takes.
// ═══════════════════════════════════════════════════════════════════════════

import type { EvalScenario, EvalBridge } from "../eval-runner.js";
import type { AssertionResult, ScenarioResult } from "../eval-report.js";
import { CALL_TIMEOUT } from "../../helpers.js";

const CALL_MS = CALL_TIMEOUT;

type WorkflowResult = {
  name: string;
  assertions: AssertionResult[];
  toolCalls: number;
  optimalCalls: number;
  /** Groups that teardown/cleanup would need under the standard profile. */
  groupsNeeded?: string[];
};

// ── Workflow 1: Create a player character ─────────────────────────────────
// Optimal: scene.create → scene.create_node (CharacterBody3D) →
//          scene.create_node (CollisionShape3D) → node.set_property ×2 →
//          script.write → script.check = 7 calls
async function playerCharacterWorkflow(bridge: EvalBridge): Promise<WorkflowResult> {
  const assertions: AssertionResult[] = [];
  let toolCalls = 0;
  const scenePath = "res://eval_eff_player.tscn";
  const scriptPath = "res://eval_eff_player.gd";
  const OPTIMAL = 7;

  const call = async (method: string, params?: unknown): Promise<unknown> => {
    toolCalls++;
    return bridge.call(method, params, CALL_MS);
  };

  // Step 1: Create scene
  const scene = (await call("scene.create", {
    file_path: scenePath,
    root_type: "Node3D",
    if_exists: "replace",
  })) as { status?: string };

  assertions.push({
    label: "create player scene",
    passed: scene?.status === "created" || scene?.status === "replaced",
  });

  await bridge.call("scene.open", { file_path: scenePath }, CALL_MS);

  // Step 2: Add CharacterBody3D
  const body = (await call("scene.create_node", {
    class_name: "CharacterBody3D",
    parent_path: ".",
    node_name: "Player",
  })) as { status?: string };

  assertions.push({
    label: "create CharacterBody3D",
    passed: body?.status === "created",
  });

  // Step 3: Add CollisionShape3D
  const col = (await call("scene.create_node", {
    class_name: "CollisionShape3D",
    parent_path: "Player",
    node_name: "Collision",
  })) as { status?: string };

  assertions.push({
    label: "create CollisionShape3D",
    passed: col?.status === "created",
  });

  // Step 4-5: Set properties
  const setSpeed = (await call("node.set_property", {
    node_path: "Player",
    property: "editor_description",
    value: "Player character",
  })) as { success?: boolean };

  assertions.push({ label: "set description", passed: setSpeed?.success === true });

  const setFloor = (await call("node.set_property", {
    node_path: "Player",
    property: "floor_max_angle",
    value: 0.7853981, // 45 degrees
  })) as { success?: boolean };

  assertions.push({ label: "set floor_max_angle", passed: setFloor?.success === true });

  // Step 6: Write script
  const script = (await call("script.write", {
    file_path: scriptPath,
    content: [
      "extends CharacterBody3D",
      "",
      "const SPEED = 5.0",
      "const JUMP_VELOCITY = 4.5",
      "",
      "func _physics_process(delta: float) -> void:",
      "\tif not is_on_floor():",
      "\t\tvelocity += get_gravity() * delta",
      "\tmove_and_slide()",
      "",
    ].join("\n"),
  })) as { success?: boolean };

  assertions.push({ label: "write player script", passed: script?.success === true });

  // Step 7: Validate script
  const check = (await call("script.check", { file_path: scriptPath })) as { valid?: boolean };

  assertions.push({
    label: "script.check validates player script",
    passed: check?.valid === true,
  });

  // Teardown (not counted — uses asset_management group tools)
  await bridge.call("scene.close", { file_path: scenePath }, CALL_MS);
  await bridge.call("scene.open", { file_path: "res://Main.tscn" }, CALL_MS);
  await bridge.call("scene.delete", { file_path: scenePath }, CALL_MS);
  await bridge.call("script.delete", { file_path: scriptPath }, CALL_MS);

  return {
    name: "create-player-character",
    assertions,
    toolCalls,
    optimalCalls: OPTIMAL,
    groupsNeeded: ["asset_management"],
  };
}

// ── Workflow 2: Find and configure a physics body ─────────────────────────
// Optimal: classdb.search → classdb.get_info → node.set_property = 3 calls
async function findAndConfigureWorkflow(bridge: EvalBridge): Promise<WorkflowResult> {
  const assertions: AssertionResult[] = [];
  let toolCalls = 0;
  const OPTIMAL = 3;

  const call = async (method: string, params?: unknown): Promise<unknown> => {
    toolCalls++;
    return bridge.call(method, params, CALL_MS);
  };

  // Create a test node first (not counted in workflow calls)
  await bridge.call(
    "scene.create_node",
    { class_name: "RigidBody3D", parent_path: ".", node_name: "EvalPhysicsBody" },
    CALL_MS,
  );

  // Step 1: Search for physics body types
  const search = (await call("classdb.search", { base_class: "PhysicsBody3D" })) as {
    success?: boolean;
    classes?: { name: string }[];
  };

  assertions.push({
    label: "classdb.search finds physics bodies",
    passed: search?.success === true && (search?.classes?.length ?? 0) > 0,
  });

  // Step 2: Get info about RigidBody3D to discover properties
  const info = (await call("classdb.get_info", { class_name: "RigidBody3D" })) as {
    success?: boolean;
    properties?: { name: string }[];
  };

  const hasMass = info?.properties?.some((p) => p.name === "mass");
  assertions.push({
    label: "classdb.get_info reveals mass property",
    passed: hasMass === true,
  });

  // Step 3: Set the discovered property
  const setProp = (await call("node.set_property", {
    node_path: "EvalPhysicsBody",
    property: "mass",
    value: 5.0,
  })) as { success?: boolean };

  assertions.push({
    label: "set mass property in one call",
    passed: setProp?.success === true,
  });

  // Teardown
  await bridge.call("scene.delete_node", { node_path: "EvalPhysicsBody" }, CALL_MS);

  return { name: "find-and-configure-physics", assertions, toolCalls, optimalCalls: OPTIMAL };
}

// ── Workflow 3: Debug a script error ──────────────────────────────────────
// Optimal: script.write (broken) → script.check → script.write (fixed) →
//          script.check (validates) = 4 calls
async function debugScriptWorkflow(bridge: EvalBridge): Promise<WorkflowResult> {
  const assertions: AssertionResult[] = [];
  let toolCalls = 0;
  const scriptPath = "res://eval_eff_debug.gd";
  const OPTIMAL = 4;

  const call = async (method: string, params?: unknown): Promise<unknown> => {
    toolCalls++;
    return bridge.call(method, params, CALL_MS);
  };

  // Step 1: Write a broken script
  const writeBroken = (await call("script.write", {
    file_path: scriptPath,
    content: ["extends Node", "", "func broken(", "\tvar x = ", ""].join("\n"),
  })) as { success?: boolean };

  assertions.push({ label: "write broken script", passed: writeBroken?.success === true });

  // Step 2: Check → get diagnostics
  const checkBroken = (await call("script.check", { file_path: scriptPath })) as {
    valid?: boolean;
    diagnostics?: { line: number; message: string }[];
  };

  assertions.push({
    label: "script.check detects errors",
    passed: checkBroken?.valid === false,
  });
  assertions.push({
    label: "diagnostics provide line info",
    passed: (checkBroken?.diagnostics?.length ?? 0) > 0 && typeof checkBroken?.diagnostics?.[0]?.line === "number",
  });

  // Step 3: Fix based on diagnostics (write corrected version)
  const writeFix = (await call("script.write", {
    file_path: scriptPath,
    content: ["extends Node", "", "func fixed() -> void:", '\tvar x = "hello"', "\tprint(x)", ""].join("\n"),
  })) as { success?: boolean };

  assertions.push({ label: "write fixed script", passed: writeFix?.success === true });

  // Step 4: Re-check → should pass
  const checkFixed = (await call("script.check", { file_path: scriptPath })) as { valid?: boolean };

  assertions.push({
    label: "fixed script validates",
    passed: checkFixed?.valid === true,
  });

  // Teardown
  await bridge.call("script.delete", { file_path: scriptPath }, CALL_MS);

  return { name: "debug-script-error", assertions, toolCalls, optimalCalls: OPTIMAL };
}

// ── Scenario entry point ─────────────────────────────────────────────────

export const workflowEfficiency: EvalScenario = {
  name: "workflow-efficiency",
  dimension: "efficiency",

  async run(bridge: EvalBridge): Promise<ScenarioResult> {
    const start = Date.now();
    const allAssertions: AssertionResult[] = [];
    let totalCalls = 0;
    let totalOptimal = 0;

    const workflows = [
      await playerCharacterWorkflow(bridge),
      await findAndConfigureWorkflow(bridge),
      await debugScriptWorkflow(bridge),
    ];

    const allGroups = new Set<string>();

    for (const w of workflows) {
      // Add workflow-specific assertions
      for (const a of w.assertions) {
        allAssertions.push({ ...a, label: `[${w.name}] ${a.label}` });
      }

      // Add efficiency assertion
      allAssertions.push({
        label: `[${w.name}] efficiency: ${w.toolCalls} calls (optimal=${w.optimalCalls})`,
        passed: w.toolCalls <= w.optimalCalls,
        detail: w.toolCalls > w.optimalCalls ? `${w.toolCalls - w.optimalCalls} extra call(s)` : undefined,
      });

      totalCalls += w.toolCalls;
      totalOptimal += w.optimalCalls;
      for (const g of w.groupsNeeded ?? []) allGroups.add(g);
    }

    return {
      name: workflowEfficiency.name,
      dimension: "efficiency",
      assertions: allAssertions,
      toolCalls: totalCalls,
      optimalToolCalls: totalOptimal,
      groupsNeeded: allGroups.size > 0 ? [...allGroups] : undefined,
      durationMs: Date.now() - start,
    };
  },
};
