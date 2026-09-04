/**
 * Unit tests for startup/lifecycle.ts — the handlers that decide when the process
 * exits.
 *
 * The contract under test is process-global (signals, stdio EOF, exit codes), so
 * each case runs the handlers in a throwaway child process and asserts on how that
 * child terminates. Asserting in-process is not an option: the paths under test end
 * in process.exit, which would take the test runner down with them.
 *
 * The broken-pipe cases are the regression guard for a bug where the
 * uncaughtException handler logged EPIPE to the stderr that had just raised it,
 * re-entered itself, and spun the event loop at 100% CPU forever.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, openSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const LIFECYCLE = resolve(HERE, "../../src/startup/lifecycle.ts");
const workDir = mkdtempSync(join(tmpdir(), "lifecycle-test-"));

/** Wait for a child to exit, or resolve `null` if it outlives the deadline —
 *  "still running" is a real expected outcome here, not only a timeout. */
function exitWithin(child: ReturnType<typeof spawn>, ms: number): Promise<number | null> {
  return new Promise((resolveExit) => {
    const timer = setTimeout(() => resolveExit(null), ms);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolveExit(code);
    });
  });
}

/** Write a child script that installs the handlers against a stub bridge, then
 *  provokes one failure mode. `body` is appended after the handlers are armed. */
function fixture(name: string, body: string): string {
  const path = join(workDir, `${name}.mjs`);
  writeFileSync(
    path,
    `import { installProcessHandlers } from ${JSON.stringify(LIFECYCLE)};\n` +
      `installProcessHandlers({ close: async () => {} });\n` +
      `setInterval(() => {}, 1000);\n` + // hold the loop open so only the handlers can end this process
      body,
    "utf8",
  );
  return path;
}

/** Run a fixture under the tsx loader, with stdout/stderr sent wherever the case needs. */
function run(path: string, stdio: Parameters<typeof spawn>[2]["stdio"]): ReturnType<typeof spawn> {
  return spawn(process.execPath, ["--import", "tsx", path], { stdio });
}

// ── A write to a dead stdout pipe exits, and exits cleanly ───────────

{
  const path = fixture("stdout-epipe", `setTimeout(() => { process.stdout.write("x".repeat(1024)); }, 300);\n`);
  const child = run(path, ["ignore", "pipe", "pipe"]);
  child.stdout?.destroy(); // the reader goes away, exactly as a departing client's does
  child.stderr?.resume();
  const code = await exitWithin(child, 8000);
  assert.equal(code, 0, "a broken stdout pipe exits 0 rather than spinning");
  child.kill("SIGKILL");
}

// ── A stderr write from inside uncaughtException cannot re-enter itself ──

{
  const path = fixture(
    "stderr-epipe-storm",
    `setTimeout(() => { throw Object.assign(new Error("broken pipe"), { code: "EPIPE" }); }, 300);\n`,
  );
  const child = run(path, ["ignore", "ignore", "pipe"]);
  child.stderr?.destroy();
  const code = await exitWithin(child, 8000);
  assert.equal(code, 0, "an EPIPE reaching uncaughtException exits instead of looping");
  child.kill("SIGKILL");
}

// ── End of input on stdin shuts the server down ─────────────────────

{
  const path = fixture("stdin-eof", `process.stdin.on("data", () => {});\n`);
  const logFile = openSync(join(workDir, "stdin-eof.log"), "a");
  const child = spawn(process.execPath, ["--import", "tsx", path], { stdio: ["pipe", logFile, logFile] });
  setTimeout(() => child.stdin?.end(), 300);
  const code = await exitWithin(child, 8000);
  assert.equal(code, 0, "stdin EOF shuts the server down");
  child.kill("SIGKILL");
}

// ── An ordinary stray error still leaves the bridge running (§7.6) ───

{
  const path = fixture("stray-error", `setTimeout(() => { throw new Error("stray, not a pipe failure"); }, 300);\n`);
  const child = run(path, ["ignore", "ignore", "pipe"]);
  child.stderr?.resume();
  const code = await exitWithin(child, 3000);
  assert.equal(code, null, "a non-pipe uncaughtException must not take the bridge down");
  child.kill("SIGKILL");
}

// ── A stray rejection likewise leaves the bridge running (§7.6) ──────

{
  const path = fixture("stray-rejection", `setTimeout(() => { void Promise.reject(new Error("stray")); }, 300);\n`);
  const child = run(path, ["ignore", "ignore", "pipe"]);
  child.stderr?.resume();
  const code = await exitWithin(child, 3000);
  assert.equal(code, null, "a non-pipe unhandledRejection must not take the bridge down");
  child.kill("SIGKILL");
}

rmSync(workDir, { recursive: true, force: true });

console.log("All 5 tests passed.");
