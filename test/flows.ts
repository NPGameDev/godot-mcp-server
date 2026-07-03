// ═══════════════════════════════════════════════════════════════════════════
// Flow suite orchestrator (41m-bis) — the deterministic counterpart to the LLM
// sweep. Covers the cross-tool, stateful flows smoke structurally cannot
// express (extension lifecycle, hot-reload reachability, combo chains). Shares
// smoke's harness (test/harness.ts + test/helpers.ts) — NOT the dispatch raw-WS
// helpers — so the per-section/step report, exit codes, and --only/--from/--to
// flags come for free.
//
// Editor-required, local-only (no CI mode — decision #8). A flow FAILURE is
// handed to a targeted LLM sweep re-run to classify stale-script vs real
// regression (report-only / manual — decision #10). See CONTEXT.md "Validation
// vocabulary".
//
// Exit codes:
//   0 — all flows passed
//   1 — one or more flows failed
//   2 — precondition failure (Godot not running, port not listening, etc.)
//
// Flags: --from N | --to N | --only N,M,O | --skip N,M,O
// ═══════════════════════════════════════════════════════════════════════════

import { makeCounters, parseFilterFlags, runFullSuite } from "./harness.js";
import type { Section } from "./harness.js";

import * as flow01 from "./flows/01_extension_lifecycle.js";
import * as flow02 from "./flows/02_hot_reload_reachability.js";
import * as flow03 from "./flows/03_combo_chains.js";
import * as flow04 from "./flows/04_non_tool_call_method.js";

const counters = makeCounters("flows");
const flags = parseFilterFlags();

const ALL_FLOWS: Section[] = [
  { num: 1, name: "extension_lifecycle", run: flow01.testExtensionLifecycle },
  { num: 2, name: "hot_reload_reachability", run: flow02.testHotReloadReachability },
  { num: 3, name: "combo_chains", run: flow03.testComboChains },
  { num: 4, name: "non_tool_call_method", run: flow04.testNonToolCallMethod },
];

async function main(): Promise<void> {
  await runFullSuite({
    label: "flows",
    counters,
    sections: ALL_FLOWS,
    flags,
    // Flows run at full speed — short suite, self-paced via editor.wait_for_idle
    // where determinism matters. No inter-section sleep.
  });
}

main().catch((err) => {
  console.error("[flows] FAIL unexpected:", err);
  process.exit(2);
});
