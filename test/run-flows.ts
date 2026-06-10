// ═══════════════════════════════════════════════════════════════════════════
// Flow suite runner — executes test/flows.ts (41m-bis).
//
// GODOT_MCP_PROJECT_NAME is set so token resolution works when the flow harness
// runs from the server repo (cwd != Godot project root). Mirrors run-smoke.ts.
//
// Exit codes:
//   0 — all flows passed
//   1 — one or more flows failed
//   2 — precondition failure (Godot not running / port not listening)
// ═══════════════════════════════════════════════════════════════════════════

import { spawn } from "node:child_process";

const PROJECT_NAME = process.env.GODOT_MCP_PROJECT_NAME ?? "Godot MCP Toolkit";

// Forward CLI flags (--from, --to, --only, --skip) to the flows.ts invocation.
const flowArgs = process.argv.slice(2);

async function main(): Promise<void> {
  const bar = "=".repeat(60);
  console.log(`\n${bar}`);
  console.log(`  FLOW SUITE`);
  console.log(`${bar}\n`);

  const code = await new Promise<number>((resolve) => {
    const child = spawn(process.execPath, ["--import", "tsx", "test/flows.ts", ...flowArgs], {
      env: {
        ...process.env,
        GODOT_MCP_PROJECT_NAME: PROJECT_NAME,
      },
      stdio: "inherit",
    });
    child.on("error", (err) => {
      console.error(`  spawn failed: ${err.message}`);
      resolve(1);
    });
    child.on("close", (c) => resolve(c ?? 1));
  });

  process.exit(code);
}

main();
