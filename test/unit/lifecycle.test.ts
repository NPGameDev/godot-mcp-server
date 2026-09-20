/**
 * Unit tests for startup/lifecycle.ts — the departure shutdown and the rules around it.
 *
 * Each case runs installProcessHandlers in a throwaway child process (the paths under
 * test end in process.exit) against a stub bridge that records its close() calls in a
 * log file. The child echoes stdin → stdout, so "still serving" is observable, and
 * writes a stderr tick every 100 ms — the diagnostic writes that once fed the storm.
 *
 * Regression guard for #2: the crash handler logged EPIPE to the stderr that had just
 * raised it, re-entered itself, and spun the event loop at 100% forever.
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { SHUTDOWN_DEADLINE_MS } from "../../src/startup/lifecycle.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
// A file:// URL: Windows reads a bare absolute path as an unsupported "c:" protocol.
const LIFECYCLE = pathToFileURL(resolve(HERE, "../../src/startup/lifecycle.ts")).href;
const workDir = mkdtempSync(join(tmpdir(), "lifecycle-test-"));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Resolve the exit code, or `null` if the child outlives the deadline — "still
 *  running" is an expected outcome for the keep-alive cases, not only a timeout. */
function exitWithin(child: ChildProcess, ms: number): Promise<number | null> {
  return new Promise((resolveExit) => {
    if (child.exitCode !== null) return resolveExit(child.exitCode);
    const timer = setTimeout(() => resolveExit(null), ms);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolveExit(code);
    });
  });
}

const FIXTURE = join(workDir, "fixture.mjs");
// String.raw is load-bearing: the fixture is source, so its own escapes must survive.
writeFileSync(
  FIXTURE,
  String.raw`import { appendFileSync } from "node:fs";
import { installProcessHandlers } from ${JSON.stringify(LIFECYCLE)};
const [mode, log] = process.argv.slice(2); // mode: normal | hang-close | throw-epipe
const note = (s) => appendFileSync(log, s + "\n");
let closes = 0;
installProcessHandlers({
  close: () => {
    closes++;
    note("close#" + closes);
    return mode === "hang-close" ? new Promise(() => {}) : Promise.resolve();
  },
});
setInterval(() => {}, 1000); // hold the loop open: only the handlers may end this process
setInterval(() => process.stderr.write("tick\n"), 100); // the periodic diagnostic writes
process.stdin.on("data", (d) => process.stdout.write("echo:" + d)); // "still serving"
if (mode === "throw-epipe") {
  setTimeout(() => { throw Object.assign(new Error("synthetic"), { code: "EPIPE" }); }, 300);
}
note("ready");
`,
  "utf8",
);

function start(name: string, mode = "normal") {
  const log = join(workDir, `${name}.log`);
  writeFileSync(log, "");
  const child = spawn(process.execPath, ["--import", "tsx", FIXTURE, mode, log], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let out = "";
  child.stdout!.on("data", (d: Buffer) => (out += d.toString()));
  child.stderr!.on("data", () => {}); // keep the reader alive until a case destroys it
  const notes = () => readFileSync(log, "utf8").split("\n").filter(Boolean);
  const closes = () => notes().filter((l) => l.startsWith("close#")).length;
  return { child, notes, closes, out: () => out };
}

const EXIT_WINDOW = SHUTDOWN_DEADLINE_MS + 3_000; // generous for slow CI runners

// ── 1. stdin EOF → departure shutdown, bridge closed once, exit 0 ─────────
{
  const t = start("stdin-eof");
  await sleep(400);
  t.child.stdin!.end();
  assert.equal(await exitWithin(t.child, EXIT_WINDOW), 0, "stdin EOF exits 0");
  assert.equal(t.closes(), 1, "bridge.close() called exactly once");
}

// ── 2. dead stdout → the next response fails → exit 0 (transport-dead) ────
{
  const t = start("stdout-dead");
  await sleep(400);
  t.child.stdout!.destroy(); // the client's reader goes away
  t.child.stdin!.write("ping\n"); // provoke a response write
  assert.equal(await exitWithin(t.child, EXIT_WINDOW), 0, "a dead stdout exits 0");
  assert.equal(t.closes(), 1);
}

// ── 3. dead stderr → muted; the server keeps answering ───────────────────
{
  const t = start("stderr-dead");
  await sleep(400);
  t.child.stderr!.destroy(); // several ticks now fail with EPIPE
  await sleep(800);
  t.child.stdin!.write("ping\n");
  await sleep(1_000);
  assert.match(t.out(), /echo:ping/, "still serving after stderr died");
  assert.equal(await exitWithin(t.child, 500), null, "a dead stderr does not end the process");
  assert.equal(t.closes(), 0);
  t.child.kill();
}

// ── 4. a synthetic EPIPE in uncaughtException does not exit (§7.6) ───────
{
  const t = start("throw-epipe", "throw-epipe");
  assert.equal(await exitWithin(t.child, 2_000), null, "an EPIPE-coded stray error keeps the bridge alive");
  assert.equal(t.closes(), 0);
  t.child.kill();
}

// ── 5. a bridge.close() that never resolves still exits inside the bound ──
{
  const t = start("hang-close", "hang-close");
  await sleep(400);
  const started = Date.now();
  t.child.stdin!.end();
  assert.equal(await exitWithin(t.child, EXIT_WINDOW), 0, "hung close still exits 0");
  assert.ok(Date.now() - started < SHUTDOWN_DEADLINE_MS + 2_000, "…inside the deadline");
  assert.equal(t.closes(), 1);
}

// ── 6. EOF and a stream error together → one shutdown ─────────────────────
{
  const t = start("same-tick");
  await sleep(400);
  t.child.stdin!.write("ping\n");
  t.child.stdout!.destroy();
  t.child.stdin!.end();
  assert.equal(await exitWithin(t.child, EXIT_WINDOW), 0);
  assert.equal(t.closes(), 1, "re-entrancy guard: bridge.close() once");
}

// ── 7. SIGTERM → departure shutdown (POSIX only: Windows has no signals) ──
if (process.platform !== "win32") {
  const t = start("sigterm");
  await sleep(400);
  t.child.kill("SIGTERM");
  assert.equal(await exitWithin(t.child, EXIT_WINDOW), 0, "SIGTERM exits 0");
  assert.equal(t.closes(), 1);
}

rmSync(workDir, { recursive: true, force: true });
console.log(`All ${process.platform === "win32" ? 6 : 7} lifecycle tests passed.`);
