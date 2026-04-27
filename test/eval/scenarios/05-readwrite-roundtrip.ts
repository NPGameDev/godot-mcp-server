// ═══════════════════════════════════════════════════════════════════════════
// Correctness Eval 05 — Read/Write Round-trip
//
// Writes data via tools, reads it back, and verifies exact matches.
// Tests both resource properties and script content for data integrity.
// ═══════════════════════════════════════════════════════════════════════════

import type { EvalScenario, EvalBridge } from "../eval-runner.js";
import type { AssertionResult, ScenarioResult } from "../eval-report.js";
import { CALL_TIMEOUT, unwrapUntrusted } from "../../helpers.js";

const CALL_MS = CALL_TIMEOUT;
const SCRIPT_PATH = "res://eval_roundtrip.gd";
const RESOURCE_PATH = "res://eval_roundtrip.tres";

export const readwriteRoundtrip: EvalScenario = {
  name: "readwrite-roundtrip",
  dimension: "correctness",

  async run(bridge: EvalBridge): Promise<ScenarioResult> {
    const assertions: AssertionResult[] = [];
    let toolCalls = 0;
    const start = Date.now();

    const call = async (method: string, params?: unknown): Promise<unknown> => {
      toolCalls++;
      return bridge.call(method, params, CALL_MS);
    };

    // ── Script content round-trip ────────────────────────────────────────
    const scriptContent = [
      "extends Node",
      "",
      "## Eval round-trip test script",
      "var test_value: int = 42",
      'var test_string: String = "hello world"',
      "var test_array: Array = [1, 2, 3]",
      "",
      "func _ready() -> void:",
      "\tprint(test_value)",
      "",
    ].join("\n");

    const writeResult = (await call("script.write", {
      file_path: SCRIPT_PATH,
      content: scriptContent,
    })) as { success?: boolean };

    assertions.push({
      label: "script.write succeeds",
      passed: writeResult?.success === true,
    });

    const readResult = (await call("script.read", {
      file_path: SCRIPT_PATH,
    })) as { content?: string };

    const readContent =
      typeof readResult?.content === "string" ? (unwrapUntrusted(readResult.content) as string) : null;

    assertions.push({
      label: "script.read returns content",
      passed: typeof readContent === "string" && readContent.length > 0,
    });
    assertions.push({
      label: "script content matches exactly",
      passed: readContent === scriptContent,
      detail:
        readContent !== scriptContent
          ? `length: wrote ${scriptContent.length}, read ${readContent?.length ?? 0}`
          : undefined,
    });

    await call("script.delete", { file_path: SCRIPT_PATH });

    // ── Node property round-trip ─────────────────────────────────────────
    // Create a temporary node, set various property types, read back
    const nodeName = "EvalRoundtripNode";
    const createNode = (await call("scene.create_node", {
      class_name: "Node2D",
      parent_path: ".",
      node_name: nodeName,
    })) as { path?: string; status?: string };

    assertions.push({
      label: "create test node",
      passed: createNode?.status === "created" || createNode?.status === "returned",
    });

    // String property
    const marker = `eval-${Date.now()}`;
    await call("node.set_property", {
      node_path: nodeName,
      property: "editor_description",
      value: marker,
    });
    const getString = (await call("node.get_property", {
      node_path: nodeName,
      property: "editor_description",
    })) as { value?: unknown };

    assertions.push({
      label: "string property round-trip",
      passed: getString?.value === marker,
      detail: getString?.value !== marker ? `expected ${marker}, got ${getString?.value}` : undefined,
    });

    // Numeric property (rotation)
    const rotValue = 1.5707963; // ~90 degrees in radians
    await call("node.set_property", {
      node_path: nodeName,
      property: "rotation",
      value: rotValue,
    });
    const getRotation = (await call("node.get_property", {
      node_path: nodeName,
      property: "rotation",
    })) as { value?: unknown };

    assertions.push({
      label: "float property round-trip",
      passed: typeof getRotation?.value === "number" && Math.abs((getRotation.value as number) - rotValue) < 0.001,
      detail: `wrote ${rotValue}, got ${getRotation?.value}`,
    });

    // Boolean property (visible)
    await call("node.set_property", {
      node_path: nodeName,
      property: "visible",
      value: false,
    });
    const getBool = (await call("node.get_property", {
      node_path: nodeName,
      property: "visible",
    })) as { value?: unknown };

    assertions.push({
      label: "boolean property round-trip",
      passed: getBool?.value === false,
      detail: `expected false, got ${getBool?.value}`,
    });

    // Cleanup node
    await call("scene.delete_node", { node_path: nodeName });

    // ── Resource write + load round-trip ────────────────────────────────
    const resWrite = (await call("resource.write", {
      file_path: RESOURCE_PATH,
      type: "Resource",
      properties: { resource_name: "eval_probe" },
    })) as { status?: string; path?: string; resource_class?: string };

    assertions.push({
      label: "resource.write create succeeds",
      passed: resWrite?.status === "created",
      detail: resWrite?.status,
    });

    const resLoad = (await call("resource.load", {
      file_path: RESOURCE_PATH,
    })) as { properties?: unknown; code?: string };

    const loadedProps = unwrapUntrusted(resLoad?.properties) as { resource_name?: string } | undefined;
    assertions.push({
      label: "resource.load reads back created resource",
      passed: resLoad?.code === undefined && loadedProps !== undefined,
    });
    assertions.push({
      label: "resource property round-trip",
      passed: loadedProps?.resource_name === "eval_probe",
      detail: `resource_name=${loadedProps?.resource_name}`,
    });

    // Cleanup (resource.delete is in asset_management group)
    await call("resource.delete", { file_path: RESOURCE_PATH });

    return {
      name: readwriteRoundtrip.name,
      dimension: "correctness",
      assertions,
      toolCalls,
      groupsNeeded: ["asset_management"],
      durationMs: Date.now() - start,
    };
  },
};
