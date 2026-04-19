// ═════════════════════════════════════════════════════════════════════════
// Dual-pass smoke runner — executes test/smoke.ts twice:
//   Pass 1: ALL gates OFF  (base catalogue, gated sections skip)
//   Pass 2: ALL gates ON   (expanded catalogue, gated sections exercise)
//
// Both passes set GODOT_MCP_PROJECT_NAME so token resolution works when
// the smoke harness runs from the server repo (cwd != Godot project root).
//
// Exit 0 only when both passes succeed.
// ═════════════════════════════════════════════════════════════════════════

import { spawn } from "node:child_process";
import { allFeatures, envVarFor } from "../src/feature_gate.js";

const PROJECT_NAME = process.env.GODOT_MCP_PROJECT_NAME ?? "Godot MCP Toolkit";

function run(label: string, env: Record<string, string>): Promise<boolean> {
  const bar = "=".repeat(60);
  console.log(`\n${bar}`);
  console.log(`  ${label}`);
  console.log(`${bar}\n`);
  return new Promise<boolean>((resolve) => {
    const child = spawn(process.execPath, ["--import", "tsx", "test/smoke.ts"], {
      env: { ...process.env, ...env },
      stdio: "inherit",
    });
    child.on("error", (err) => {
      console.error(`  spawn failed: ${err.message}`);
      resolve(false);
    });
    child.on("close", (code) => resolve(code === 0));
  });
}

async function main(): Promise<void> {
  const base: Record<string, string> = {
    GODOT_MCP_PROJECT_NAME: PROJECT_NAME,
  };

  // Pass 1 — all gates off (no GODOT_MCP_ALLOW_* env vars).
  const offOk = await run("SMOKE PASS 1 / 2 : ALL GATES OFF", base);

  // Pass 2 — all gates on.
  const gatesOn: Record<string, string> = { ...base };
  for (const feature of allFeatures()) {
    const v = envVarFor(feature);
    if (v) gatesOn[v] = "1";
  }
  // Smoke harness opt-in for user-scope round-trip tests.
  gatesOn["MCP_ENABLE_USER_SCOPE"] = "1";

  const onOk = await run("SMOKE PASS 2 / 2 : ALL GATES ON", gatesOn);

  // Summary.
  const bar = "=".repeat(60);
  console.log(`\n${bar}`);
  console.log(`  Gates OFF : ${offOk ? "PASS" : "FAIL"}`);
  console.log(`  Gates ON  : ${onOk ? "PASS" : "FAIL"}`);
  console.log(`${bar}\n`);

  process.exit(offOk && onOk ? 0 : 1);
}

main();
