// ═══════════════════════════════════════════════════════════════════════════
// Correctness Eval 02 — ClassDB Accuracy
//
// Queries ClassDB for well-known classes and verifies the results match
// Godot API documentation expectations.
// ═══════════════════════════════════════════════════════════════════════════

import type { EvalScenario, EvalBridge } from "../eval-runner.js";
import type { AssertionResult, ScenarioResult } from "../eval-report.js";
import { CALL_TIMEOUT } from "../../helpers.js";

const CALL_MS = CALL_TIMEOUT;

export const classdbAccuracy: EvalScenario = {
  name: "classdb-accuracy",
  dimension: "correctness",

  async run(bridge: EvalBridge): Promise<ScenarioResult> {
    const assertions: AssertionResult[] = [];
    let toolCalls = 0;
    const start = Date.now();

    const call = async (method: string, params?: unknown): Promise<unknown> => {
      toolCalls++;
      return bridge.call(method, params, CALL_MS);
    };

    // ── RigidBody3D: verify mass property exists ─────────────────────────
    const rigid = (await call("classdb.get_info", { class_name: "RigidBody3D" })) as {
      success?: boolean;
      parent?: string;
      properties?: { name: string; type?: string }[];
      methods?: { name: string }[];
    };

    assertions.push({
      label: "classdb.get_info RigidBody3D succeeds",
      passed: rigid?.success === true,
    });

    const hasMass = rigid?.properties?.some((p) => p.name === "mass");
    assertions.push({
      label: "RigidBody3D has 'mass' property",
      passed: hasMass === true,
    });

    assertions.push({
      label: "RigidBody3D parent is PhysicsBody3D",
      passed: rigid?.parent === "PhysicsBody3D",
      detail: rigid?.parent,
    });

    // ── PhysicsBody3D search: verify known subclasses ────────────────────
    const search = (await call("classdb.search", { base_class: "PhysicsBody3D" })) as {
      success?: boolean;
      classes?: { name: string }[];
    };

    assertions.push({
      label: "classdb.search PhysicsBody3D succeeds",
      passed: search?.success === true,
    });

    const classNames = search?.classes?.map((c) => c.name) ?? [];
    assertions.push({
      label: "search includes RigidBody3D",
      passed: classNames.includes("RigidBody3D"),
    });
    assertions.push({
      label: "search includes CharacterBody3D",
      passed: classNames.includes("CharacterBody3D"),
    });
    assertions.push({
      label: "search includes StaticBody3D",
      passed: classNames.includes("StaticBody3D"),
    });

    // ── Node2D inheritance chain ─────────────────────────────────────────
    const node2d = (await call("classdb.get_info", { class_name: "Node2D" })) as {
      success?: boolean;
      inheritance_chain?: string[];
    };

    assertions.push({
      label: "Node2D inheritance chain includes CanvasItem",
      passed: node2d?.inheritance_chain?.includes("CanvasItem") === true,
    });
    assertions.push({
      label: "Node2D inheritance chain includes Node",
      passed: node2d?.inheritance_chain?.includes("Node") === true,
    });
    assertions.push({
      label: "Node2D inheritance chain includes Object",
      passed: node2d?.inheritance_chain?.includes("Object") === true,
    });

    // ── Control: verify common UI properties ─────────────────────────────
    const control = (await call("classdb.get_info", {
      class_name: "Control",
      include_inherited: true,
    })) as {
      success?: boolean;
      properties?: { name: string }[];
    };

    assertions.push({
      label: "Control has 'size' property (inherited)",
      passed: control?.properties?.some((p) => p.name === "size") === true,
    });

    // ── Pattern search for "Sprite" ──────────────────────────────────────
    const sprites = (await call("classdb.search", { pattern: "Sprite" })) as {
      success?: boolean;
      classes?: { name: string }[];
    };

    const spriteNames = sprites?.classes?.map((c) => c.name) ?? [];
    assertions.push({
      label: "pattern 'Sprite' finds Sprite2D",
      passed: spriteNames.includes("Sprite2D"),
    });
    assertions.push({
      label: "pattern 'Sprite' finds Sprite3D",
      passed: spriteNames.includes("Sprite3D"),
    });

    return {
      name: classdbAccuracy.name,
      dimension: "correctness",
      assertions,
      toolCalls,
      durationMs: Date.now() - start,
    };
  },
};
