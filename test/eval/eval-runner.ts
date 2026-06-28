// ═══════════════════════════════════════════════════════════════════════════
// Eval runner — orchestrates accuracy + efficiency eval scenarios against
// a live Godot instance. Separate from smoke (smoke = "does it work",
// eval = "does it work well").
//
// Exit codes:
//   0 — all scenarios passed
//   1 — one or more assertions failed
//   2 — precondition failure (Godot not running)
// ═══════════════════════════════════════════════════════════════════════════

import { createBridge } from "../../src/transport/bridge.js";
import { registryPath } from "../../src/registry.js";
import { readFileSync } from "node:fs";
import { HOST, PORT, RUNTIME_PORT, PROBE_TIMEOUT_MS, probePort, printUnreachable } from "../helpers.js";
import type { ScenarioResult } from "./eval-report.js";
import { buildReport, printReport } from "./eval-report.js";

import { sceneCreation } from "./scenarios/01-scene-creation.js";
import { classdbAccuracy } from "./scenarios/02-classdb-accuracy.js";
import { scriptValidation } from "./scenarios/03-script-validation.js";
import { errorRecovery } from "./scenarios/04-error-recovery.js";
import { readwriteRoundtrip } from "./scenarios/05-readwrite-roundtrip.js";
import { workflowEfficiency } from "./scenarios/06-workflow-efficiency.js";

export type EvalBridge = {
  call(method: string, params?: unknown, timeoutMs?: number): Promise<unknown>;
  close(): Promise<void>;
};

export type EvalScenario = {
  name: string;
  dimension: "correctness" | "efficiency";
  run(bridge: EvalBridge): Promise<ScenarioResult>;
};

const SCENARIOS: EvalScenario[] = [
  sceneCreation,
  classdbAccuracy,
  scriptValidation,
  errorRecovery,
  readwriteRoundtrip,
  workflowEfficiency,
];

function discoverProjectPath(): string | undefined {
  const envPath = process.env.GODOT_MCP_PROJECT_PATH;
  if (envPath) return envPath;
  try {
    const data = JSON.parse(readFileSync(registryPath(), "utf-8")) as {
      by_path?: Record<string, { port?: number }>;
    };
    for (const [path, entry] of Object.entries(data.by_path ?? {})) {
      if (entry.port === PORT) return path;
    }
  } catch {
    // Registry unreadable — fall through.
  }
  return undefined;
}

async function main(): Promise<void> {
  const reachable = await probePort(HOST, PORT, PROBE_TIMEOUT_MS);
  if (!reachable) {
    printUnreachable();
    process.exit(2);
  }

  const projectPath = discoverProjectPath();
  const bridge = createBridge(`ws://${HOST}:${PORT}`, {
    projectPath,
    explicitRuntimePort: String(RUNTIME_PORT),
  });

  const results: ScenarioResult[] = [];

  try {
    for (const scenario of SCENARIOS) {
      console.log(`\n[eval] Running: ${scenario.name} (${scenario.dimension})`);
      try {
        const result = await scenario.run(bridge);
        results.push(result);
        const failed = result.assertions.filter((a) => !a.passed).length;
        if (failed > 0) {
          console.log(`[eval] ${scenario.name}: ${failed} assertion(s) FAILED`);
        } else {
          console.log(`[eval] ${scenario.name}: all ${result.assertions.length} assertions passed`);
        }
      } catch (err) {
        results.push({
          name: scenario.name,
          dimension: scenario.dimension,
          assertions: [{ label: "scenario execution", passed: false, detail: (err as Error).message }],
          toolCalls: 0,
          durationMs: 0,
        });
        console.error(`[eval] ${scenario.name}: CRASHED — ${(err as Error).message}`);
      }
    }
  } finally {
    await bridge.close();
  }

  const report = buildReport(results);
  printReport(report);

  process.exit(report.totalFailed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[eval] FATAL:", err);
  process.exit(2);
});
