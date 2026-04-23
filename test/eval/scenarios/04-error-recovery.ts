// ═══════════════════════════════════════════════════════════════════════════
// Correctness Eval 04 — Error Recovery
//
// Sends invalid inputs, verifies error responses include actionable hints
// (added in iter 38), and validates that following the hint leads to
// a successful tool call.
// ═══════════════════════════════════════════════════════════════════════════

import type { EvalScenario, EvalBridge } from "../eval-runner.js";
import type { AssertionResult, ScenarioResult } from "../eval-report.js";
import { CALL_TIMEOUT, unwrapUntrusted } from "../../helpers.js";

const CALL_MS = CALL_TIMEOUT;

export const errorRecovery: EvalScenario = {
  name: "error-recovery",
  dimension: "correctness",

  async run(bridge: EvalBridge): Promise<ScenarioResult> {
    const assertions: AssertionResult[] = [];
    let toolCalls = 0;
    const start = Date.now();

    const call = async (method: string, params?: unknown): Promise<unknown> => {
      toolCalls++;
      return bridge.call(method, params, CALL_MS);
    };

    // ── Case 1: Invalid node path → NOT_FOUND with hint → follow hint ───
    const badNode = (await call("scene.delete_node", { node_path: "EvalNoSuchNode_xyz" })) as {
      success?: boolean;
      code?: string;
      hint?: string;
    };

    assertions.push({
      label: "invalid node: returns NOT_FOUND",
      passed: badNode?.code === "NOT_FOUND",
      detail: badNode?.code,
    });
    assertions.push({
      label: "invalid node: hint is present",
      passed: typeof badNode?.hint === "string" && badNode.hint.length > 0,
    });
    assertions.push({
      label: "invalid node: hint mentions scene.get_tree",
      passed: typeof badNode?.hint === "string" && badNode.hint.includes("scene.get_tree"),
      detail: badNode?.hint,
    });

    // Follow the hint: call scene.get_tree → should succeed
    const treeRaw = (await call("scene.get_tree", {})) as { tree?: string; name?: string; children?: unknown[] };
    const tree = (treeRaw?.tree ? unwrapUntrusted(treeRaw.tree) : treeRaw) as {
      name?: string;
      children?: unknown[];
    };
    assertions.push({
      label: "follow hint: scene.get_tree succeeds",
      passed: typeof tree?.name === "string" || tree?.children !== undefined,
    });

    // ── Case 2: Invalid class name → INVALID_CLASS with hint ─────────────
    const badClass = (await call("scene.create_node", {
      class_name: "EvalNotAClass_xyz",
      parent_path: ".",
    })) as {
      code?: string;
      hint?: string;
    };

    assertions.push({
      label: "invalid class: returns INVALID_CLASS",
      passed: badClass?.code === "INVALID_CLASS",
      detail: badClass?.code,
    });
    assertions.push({
      label: "invalid class: hint is present",
      passed: typeof badClass?.hint === "string" && badClass.hint.length > 0,
    });
    assertions.push({
      label: "invalid class: hint mentions classdb",
      passed: typeof badClass?.hint === "string" && badClass.hint.toLowerCase().includes("classdb"),
      detail: badClass?.hint,
    });

    // Follow the hint: use classdb.search to find the right class
    const searchResult = (await call("classdb.search", { pattern: "CharacterBody" })) as {
      success?: boolean;
      classes?: { name: string }[];
    };
    assertions.push({
      label: "follow hint: classdb.search finds CharacterBody3D",
      passed: searchResult?.classes?.some((c) => c.name === "CharacterBody3D") === true,
    });

    // ── Case 3: PATH_DENIED with hint ────────────────────────────────────
    const badPath = (await call("script.write", {
      file_path: "user://eval_bad_path.gd",
      content: "x",
    })) as {
      code?: string;
      hint?: string;
    };

    assertions.push({
      label: "bad path: returns PATH_DENIED",
      passed: badPath?.code === "PATH_DENIED",
      detail: badPath?.code,
    });
    assertions.push({
      label: "bad path: hint mentions res://",
      passed: typeof badPath?.hint === "string" && badPath.hint.includes("res://"),
      detail: badPath?.hint,
    });

    // ── Case 4: Nonexistent file → NOT_FOUND with hint ───────────────────
    const badFile = (await call("script.read", {
      file_path: "res://eval_no_such_file_xyz.gd",
    })) as {
      code?: string;
      hint?: string;
    };

    assertions.push({
      label: "missing file: returns NOT_FOUND",
      passed: badFile?.code === "NOT_FOUND",
      detail: badFile?.code,
    });
    assertions.push({
      label: "missing file: hint is present",
      passed: typeof badFile?.hint === "string" && badFile.hint.length > 0,
    });

    return {
      name: errorRecovery.name,
      dimension: "correctness",
      assertions,
      toolCalls,
      durationMs: Date.now() - start,
    };
  },
};
