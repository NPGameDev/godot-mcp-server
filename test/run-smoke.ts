// ═══════════════════════════════════════════════════════════════════════════
// Dual-pass smoke runner — executes test/smoke.ts twice:
//   Pass 1: ALL gates OFF  (base catalogue, gated sections skip)
//   Pass 2: ALL gates ON   (expanded catalogue, gated sections exercise)
//
// Both passes set GODOT_MCP_PROJECT_NAME so token resolution works when
// the smoke harness runs from the server repo (cwd != Godot project root).
//
// Exit codes:
//   0 — both passes passed
//   1 — one or more tests failed in at least one pass
//   2 — precondition failure (Godot not running / port not listening)
// ═══════════════════════════════════════════════════════════════════════════

import { spawn } from "node:child_process";
import { allFeatures, envVarFor } from "../src/feature_gate.js";

const PROJECT_NAME = process.env.GODOT_MCP_PROJECT_NAME ?? "Godot MCP Toolkit";

function run(label: string, env: Record<string, string>): Promise<number> {
  const bar = "=".repeat(60);
  console.log(`\n${bar}`);
  console.log(`  ${label}`);
  console.log(`${bar}\n`);
  return new Promise<number>((resolve) => {
    const child = spawn(process.execPath, ["--import", "tsx", "test/smoke.ts"], {
      env: { ...process.env, ...env },
      stdio: "inherit",
    });
    child.on("error", (err) => {
      console.error(`  spawn failed: ${err.message}`);
      resolve(1);
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

async function main(): Promise<void> {
  const base: Record<string, string> = {
    GODOT_MCP_PROJECT_NAME: PROJECT_NAME,
  };

  // Pass 1 — all gates off (no GODOT_MCP_ALLOW_* env vars).
  const offCode = await run("SMOKE PASS 1 / 2 : ALL GATES OFF", base);
  if (offCode === 2) {
    console.error("\nPrecondition failure — aborting (Godot editor not reachable).");
    process.exit(2);
  }

  // Pass 2 — all gates on.
  const gatesOn: Record<string, string> = { ...base };
  for (const feature of allFeatures()) {
    const v = envVarFor(feature);
    if (v) gatesOn[v] = "1";
  }
  // Smoke harness opt-in for user-scope round-trip tests.
  gatesOn["MCP_ENABLE_USER_SCOPE"] = "1";

  const onCode = await run("SMOKE PASS 2 / 2 : ALL GATES ON", gatesOn);
  if (onCode === 2) {
    console.error("\nPrecondition failure — aborting.");
    process.exit(2);
  }

  // Summary.
  const bar = "=".repeat(60);
  console.log(`\n${bar}`);
  console.log(`  Gates OFF : ${offCode === 0 ? "PASS" : "FAIL"}`);
  console.log(`  Gates ON  : ${onCode === 0 ? "PASS" : "FAIL"}`);
  console.log(`${bar}\n`);

  process.exit(offCode === 0 && onCode === 0 ? 0 : 1);
}

main();
