// ═══════════════════════════════════════════════════════════════════════════
// Eval report generator — collects scenario results and prints a summary
// table with pass/fail counts, tool-call metrics, and efficiency scores.
// ═══════════════════════════════════════════════════════════════════════════

export type AssertionResult = {
  label: string;
  passed: boolean;
  detail?: string;
};

export type ScenarioResult = {
  name: string;
  dimension: "correctness" | "efficiency";
  assertions: AssertionResult[];
  toolCalls: number;
  optimalToolCalls?: number;
  durationMs: number;
};

export type EvalReport = {
  scenarios: ScenarioResult[];
  totalPassed: number;
  totalFailed: number;
  totalAssertions: number;
  timestamp: string;
};

export function buildReport(scenarios: ScenarioResult[]): EvalReport {
  let totalPassed = 0;
  let totalFailed = 0;
  for (const s of scenarios) {
    for (const a of s.assertions) {
      if (a.passed) totalPassed++;
      else totalFailed++;
    }
  }
  return {
    scenarios,
    totalPassed,
    totalFailed,
    totalAssertions: totalPassed + totalFailed,
    timestamp: new Date().toISOString(),
  };
}

export function printReport(report: EvalReport): void {
  const bar = "=".repeat(72);
  console.log(`\n${bar}`);
  console.log("  ACCURACY EVAL REPORT");
  console.log(`  ${report.timestamp}`);
  console.log(bar);

  // Per-scenario table
  const header = `${"Scenario".padEnd(38)} ${"Pass".padStart(5)} ${"Fail".padStart(5)} ${"Calls".padStart(6)} ${"Opt".padStart(5)} ${"Eff".padStart(6)} ${"Time".padStart(8)}`;
  console.log(`\n${header}`);
  console.log("-".repeat(header.length));

  for (const s of report.scenarios) {
    const passed = s.assertions.filter((a) => a.passed).length;
    const failed = s.assertions.filter((a) => !a.passed).length;
    const eff =
      s.optimalToolCalls != null ? `${Math.round((s.optimalToolCalls / Math.max(s.toolCalls, 1)) * 100)}%` : "—";
    const opt = s.optimalToolCalls != null ? String(s.optimalToolCalls) : "—";
    const time = `${s.durationMs}ms`;

    const prefix = failed > 0 ? "  FAIL " : "  PASS ";
    console.log(
      `${prefix}${s.name.padEnd(32)} ${String(passed).padStart(5)} ${String(failed).padStart(5)} ${String(s.toolCalls).padStart(6)} ${opt.padStart(5)} ${eff.padStart(6)} ${time.padStart(8)}`,
    );

    // Print failed assertions
    if (failed > 0) {
      for (const a of s.assertions) {
        if (!a.passed) {
          console.log(`         FAIL  ${a.label}${a.detail ? `: ${a.detail}` : ""}`);
        }
      }
    }
  }

  // Summary
  console.log(`\n${"-".repeat(72)}`);
  console.log(
    `  Total: ${report.totalPassed} passed, ${report.totalFailed} failed, ${report.totalAssertions} assertions`,
  );

  // Efficiency summary for scenarios that have optimal counts
  const effScenarios = report.scenarios.filter((s) => s.optimalToolCalls != null);
  if (effScenarios.length > 0) {
    const totalCalls = effScenarios.reduce((sum, s) => sum + s.toolCalls, 0);
    const totalOptimal = effScenarios.reduce((sum, s) => sum + (s.optimalToolCalls ?? 0), 0);
    const overallEff = Math.round((totalOptimal / Math.max(totalCalls, 1)) * 100);
    console.log(
      `  Efficiency: ${totalCalls} tool calls across ${effScenarios.length} workflows (${overallEff}% optimal)`,
    );
  }

  console.log(bar);
}
