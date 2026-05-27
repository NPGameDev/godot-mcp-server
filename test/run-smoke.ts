// ═══════════════════════════════════════════════════════════════════════════
// Smoke runner — executes test/smoke.ts with user-scope tests enabled.
//
// Both GODOT_MCP_PROJECT_NAME and MCP_ENABLE_USER_SCOPE are set so token
// resolution and save_* round-trip tests work when the smoke harness runs
// from the server repo (cwd != Godot project root).
//
// Exit codes:
//   0 — all tests passed
//   1 — one or more tests failed
//   2 — precondition failure (Godot not running / port not listening)
// ═══════════════════════════════════════════════════════════════════════════

import { spawn } from "node:child_process";

const PROJECT_NAME = process.env.GODOT_MCP_PROJECT_NAME ?? "Godot MCP Toolkit";

// Forward CLI flags (--from, --to, --only, --skip, --ci) to the smoke.ts invocation.
const smokeArgs = process.argv.slice(2);

async function main(): Promise<void> {
  const bar = "=".repeat(60);
  console.log(`\n${bar}`);
  console.log(`  SMOKE TEST`);
  console.log(`${bar}\n`);

  const code = await new Promise<number>((resolve) => {
    const child = spawn(process.execPath, ["--import", "tsx", "test/smoke.ts", ...smokeArgs], {
      env: {
        ...process.env,
        GODOT_MCP_PROJECT_NAME: PROJECT_NAME,
        MCP_ENABLE_USER_SCOPE: "1",
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
