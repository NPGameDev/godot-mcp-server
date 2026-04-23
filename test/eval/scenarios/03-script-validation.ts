// ═══════════════════════════════════════════════════════════════════════════
// Correctness Eval 03 — Script Validation Accuracy
//
// Writes scripts with known valid/invalid content, runs script.check,
// and verifies diagnostics match expectations (zero false positives/negatives).
// ═══════════════════════════════════════════════════════════════════════════

import type { EvalScenario, EvalBridge } from "../eval-runner.js";
import type { AssertionResult, ScenarioResult } from "../eval-report.js";
import { CALL_TIMEOUT } from "../../helpers.js";

const CALL_MS = CALL_TIMEOUT;
const VALID_PATH = "res://eval_script_valid.gd";
const BROKEN_PATH = "res://eval_script_broken.gd";
const MULTILINE_PATH = "res://eval_script_multi.gd";

export const scriptValidation: EvalScenario = {
  name: "script-validation-accuracy",
  dimension: "correctness",

  async run(bridge: EvalBridge): Promise<ScenarioResult> {
    const assertions: AssertionResult[] = [];
    let toolCalls = 0;
    const start = Date.now();

    const call = async (method: string, params?: unknown): Promise<unknown> => {
      toolCalls++;
      return bridge.call(method, params, CALL_MS);
    };

    // ── Case 1: Valid script → valid: true, empty diagnostics ────────────
    const validContent = [
      "extends Node",
      "",
      "var speed: float = 10.0",
      "var health: int = 100",
      "",
      "func _ready() -> void:",
      '\tprint("Hello from eval")',
      "\tprint(speed + health)",
      "",
    ].join("\n");

    await call("script.write", { file_path: VALID_PATH, content: validContent });
    const checkValid = (await call("script.check", { file_path: VALID_PATH })) as {
      success?: boolean;
      valid?: boolean;
      diagnostics?: unknown[];
    };

    assertions.push({
      label: "valid script: check succeeds",
      passed: checkValid?.success === true,
    });
    assertions.push({
      label: "valid script: valid=true (no false positive)",
      passed: checkValid?.valid === true,
    });
    assertions.push({
      label: "valid script: zero diagnostics",
      passed: Array.isArray(checkValid?.diagnostics) && checkValid.diagnostics.length === 0,
      detail: `got ${checkValid?.diagnostics?.length ?? "?"} diagnostic(s)`,
    });

    await call("script.delete", { file_path: VALID_PATH });

    // ── Case 2: Script with syntax error → valid: false ──────────────────
    const brokenContent = ["extends Node", "", "func broken(", "\tvar x = ", ""].join("\n");

    await call("script.write", { file_path: BROKEN_PATH, content: brokenContent });
    const checkBroken = (await call("script.check", { file_path: BROKEN_PATH })) as {
      success?: boolean;
      valid?: boolean;
      diagnostics?: { line: number; severity: string; message: string }[];
    };

    assertions.push({
      label: "broken script: check succeeds (returns result)",
      passed: checkBroken?.success === true,
    });
    assertions.push({
      label: "broken script: valid=false (no false negative)",
      passed: checkBroken?.valid === false,
    });
    assertions.push({
      label: "broken script: has diagnostics",
      passed: Array.isArray(checkBroken?.diagnostics) && checkBroken.diagnostics.length > 0,
      detail: `got ${checkBroken?.diagnostics?.length ?? 0} diagnostic(s)`,
    });

    if (checkBroken?.diagnostics && checkBroken.diagnostics.length > 0) {
      const first = checkBroken.diagnostics[0];
      assertions.push({
        label: "broken script: diagnostic has line number",
        passed: typeof first.line === "number" && first.line >= 0,
        detail: `line=${first.line}`,
      });
      assertions.push({
        label: "broken script: diagnostic has severity",
        passed: typeof first.severity === "string" && first.severity.length > 0,
      });
      assertions.push({
        label: "broken script: diagnostic has message",
        passed: typeof first.message === "string" && first.message.length > 0,
      });
    }

    await call("script.delete", { file_path: BROKEN_PATH });

    // ── Case 3: Script with multiple distinct issues ─────────────────────
    const multiContent = [
      "extends Node",
      "",
      "func test() -> void:",
      '\tvar unused_var = "hello"',
      "\tvar bad_call = nonexistent_function()",
      "",
    ].join("\n");

    await call("script.write", { file_path: MULTILINE_PATH, content: multiContent });
    const checkMulti = (await call("script.check", { file_path: MULTILINE_PATH })) as {
      success?: boolean;
      valid?: boolean;
      diagnostics?: { line: number; message: string }[];
    };

    assertions.push({
      label: "multi-error script: check returns result",
      passed: checkMulti?.success === true,
    });
    assertions.push({
      label: "multi-error script: valid=false",
      passed: checkMulti?.valid === false,
    });

    await call("script.delete", { file_path: MULTILINE_PATH });

    return {
      name: scriptValidation.name,
      dimension: "correctness",
      assertions,
      toolCalls,
      durationMs: Date.now() - start,
    };
  },
};
