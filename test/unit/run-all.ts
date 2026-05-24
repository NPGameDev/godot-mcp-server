/**
 * Auto-discovery test runner for unit tests.
 * Scans test/unit/ for *.test.ts files and runs each via tsx.
 * Exits non-zero on first failure.
 */
import { readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const testFiles = readdirSync(__dirname)
  .filter((f) => f.endsWith(".test.ts"))
  .sort();

console.log(`Discovered ${testFiles.length} test file(s):\n`);

let passed = 0;
for (const file of testFiles) {
  const filePath = join(__dirname, file);
  console.log(`── ${file} ──`);
  try {
    execSync(`npx tsx "${filePath}"`, {
      stdio: "inherit",
      cwd: join(__dirname, "../.."),
    });
    passed++;
    console.log();
  } catch {
    console.error(`\nFAILED: ${file}`);
    process.exit(1);
  }
}

console.log(`\nAll ${passed}/${testFiles.length} test files passed.`);
