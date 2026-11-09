/**
 * Unit tests for startup/lifecycle.ts — the departure shutdown and the rules around it.
 *
 * Each case runs installProcessHandlers in a throwaway child process (the paths under
 * test end in process.exit) against a stub bridge that records its close() calls in a
 * log file. The child echoes stdin → stdout, so "still serving" is observable, and
 * writes a stderr tick every 100 ms — the diagnostic writes that once fed the storm.
 * The last case runs in-process: the stdio transport createStdioTransport builds must
 * take an inbound message past the SDK's default read cap without closing.
 *
 * Regression guard for #2: the crash handler logged EPIPE to the stderr that had just
 * raised it, re-entered itself, and spun the event loop at 100% forever.
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createStdioTransport, SHUTDOWN_DEADLINE_MS } from "../../src/startup/lifecycle.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
// A file:// URL: Windows reads a bare absolute path as an unsupported "c:" protocol.
const LIFECYCLE = pathToFileURL(resolve(HERE, "../../src/startup/lifecycle.ts")).href;
const workDir = mkdtempSync(join(tmpdir(), "lifecycle-test-"));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Resolve the exit code, the signal's name if a signal killed the child, or `null` if the
 *  child outlives the deadline — "still running" is an expected outcome for the keep-alive
 *  cases, not only a timeout. */
function exitWithin(child: ChildProcess, ms: number): Promise<number | NodeJS.Signals | null> {
  return new Promise((resolveExit) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolveExit(child.exitCode ?? child.signalCode);
    const timer = setTimeout(() => resolveExit(null), ms);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolveExit(code ?? signal);
    });
  });
}

const FIXTURE = join(workDir, "fixture.mjs");
// String.raw is load-bearing: the fixture is source, so its own escapes must survive.
writeFileSync(
  FIXTURE,
  String.raw`import { appendFileSync } from "node:fs";
import { installProcessHandlers } from ${JSON.stringify(LIFECYCLE)};
const [mode, log, startDelayMs] = process.argv.slice(2); // mode: normal | hang-close | throw-epipe
const note = (s) => appendFileSync(log, s + "\n");
// Stands in for a slow module load: until the handlers below install, a signal kills the process.
if (Number(startDelayMs) > 0) await new Promise((r) => setTimeout(r, Number(startDelayMs)));
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

const READY_WAIT_MS = 30_000; // far past any healthy start, so only a stuck child reaches it
const READY_POLL_MS = 20;

function start(name: string, mode = "normal", startDelayMs = 0) {
  const log = join(workDir, `${name}.log`);
  writeFileSync(log, "");
  const child = spawn(process.execPath, ["--import", "tsx", FIXTURE, mode, log, String(startDelayMs)], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let out = "";
  child.stdout!.on("data", (d: Buffer) => (out += d.toString()));
  child.stderr!.on("data", () => {}); // keep the reader alive until a case destroys it
  const notes = () => readFileSync(log, "utf8").split("\n").filter(Boolean);
  const closes = () => notes().filter((l) => l.startsWith("close#")).length;
  /** Resolve once the fixture has written `ready`, its handlers installed. A child that ends
   *  first, or stays silent past READY_WAIT_MS, fails the suite here rather than hanging it. */
  const ready = async () => {
    const deadline = Date.now() + READY_WAIT_MS;
    for (;;) {
      if (notes().includes("ready")) return; // a child that wrote `ready` and then ended was still ready
      const ended = child.exitCode ?? child.signalCode;
      if (ended !== null) throw new Error(`${name}: child ended (${ended}) before writing ready`);
      if (Date.now() >= deadline) {
        child.kill();
        throw new Error(`${name}: child did not write ready within ${READY_WAIT_MS} ms`);
      }
      await sleep(READY_POLL_MS);
    }
  };
  return { child, notes, closes, ready, out: () => out };
}

const EXIT_WINDOW = SHUTDOWN_DEADLINE_MS + 3_000; // generous for slow CI runners
const SLOW_START_MS = 500; // on top of the load: past the child's usual time to ready

// ── 1. stdin EOF → departure shutdown, bridge closed once, exit 0 ─────────
{
  const t = start("stdin-eof");
  await t.ready();
  t.child.stdin!.end();
  assert.equal(await exitWithin(t.child, EXIT_WINDOW), 0, "stdin EOF exits 0");
  assert.equal(t.closes(), 1, "bridge.close() called exactly once");
}

// ── 1b. stdin EOF before the handlers install → still seen, bridge closed once, exit 0 ──
// end() runs in the spawn's own tick, so the EOF is on the pipe long before the fixture's
// start delay ends. Nothing reads stdin until then, which leaves the EOF for the handlers.
{
  const t = start("eof-before-handlers", "normal", SLOW_START_MS);
  t.child.stdin!.end();
  try {
    await t.ready();
    assert.equal(await exitWithin(t.child, EXIT_WINDOW), 0, "stdin EOF before the handlers install exits 0");
    assert.equal(t.closes(), 1, "stdin EOF before the handlers install closes the bridge once");
  } finally {
    t.child.kill();
  }
}

// ── 2. dead stdout → the next response fails → exit 0 (transport-dead) ────
{
  const t = start("stdout-dead");
  await t.ready();
  t.child.stdout!.destroy(); // the client's reader goes away
  t.child.stdin!.write("ping\n"); // provoke a response write
  assert.equal(await exitWithin(t.child, EXIT_WINDOW), 0, "a dead stdout exits 0");
  assert.equal(t.closes(), 1);
}

// ── 3. dead stderr → muted; the server keeps answering ───────────────────
{
  const t = start("stderr-dead");
  await t.ready();
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
  await t.ready();
  const started = Date.now();
  t.child.stdin!.end();
  assert.equal(await exitWithin(t.child, EXIT_WINDOW), 0, "hung close still exits 0");
  assert.ok(Date.now() - started < SHUTDOWN_DEADLINE_MS + 2_000, "…inside the deadline");
  assert.equal(t.closes(), 1);
}

// ── 6. EOF and a stream error together → one shutdown ─────────────────────
{
  const t = start("same-tick");
  await t.ready();
  t.child.stdin!.write("ping\n");
  t.child.stdout!.destroy();
  t.child.stdin!.end();
  assert.equal(await exitWithin(t.child, EXIT_WINDOW), 0);
  assert.equal(t.closes(), 1, "re-entrancy guard: bridge.close() once");
}

// ── 7. SIGTERM → departure shutdown (POSIX only: Windows has no signals) ──
if (process.platform !== "win32") {
  const t = start("sigterm");
  await t.ready();
  t.child.kill("SIGTERM");
  assert.equal(await exitWithin(t.child, EXIT_WINDOW), 0, "SIGTERM exits 0");
  assert.equal(t.closes(), 1);
}

// ── 7b. SIGTERM to a child that was slow to start still finds the handlers (POSIX only) ──
if (process.platform !== "win32") {
  const t = start("slow-start", "normal", SLOW_START_MS);
  try {
    await t.ready();
    t.child.kill("SIGTERM");
    assert.equal(await exitWithin(t.child, EXIT_WINDOW), 0, "SIGTERM after a slow start exits 0");
    assert.equal(t.closes(), 1, "a slow start still closes the bridge once on SIGTERM");
  } finally {
    t.child.kill();
  }
}

// ── 8. One inbound message past the SDK's default 10 MiB read cap ─────────
// With the default cap the transport would close and pause stdin, hiding the
// client's departure; the one createStdioTransport builds delivers it and stays open.
{
  const stdin = new PassThrough();
  const transport = createStdioTransport(stdin, new PassThrough());
  const received: unknown[] = [];
  let closed = false;
  transport.onmessage = (message) => received.push(message);
  transport.onclose = () => {
    closed = true;
  };
  await transport.start();
  const pad = "a".repeat(11 * 1024 * 1024);
  stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/oversize", params: { pad } }) + "\n");
  for (let waited = 0; received.length === 0 && !closed && waited < 5_000; waited += 20) await sleep(20);
  assert.equal(closed, false, "an oversize message must not close the transport");
  assert.equal(received.length, 1, "the oversize message is delivered");
  await transport.close();
}

rmSync(workDir, { recursive: true, force: true });
console.log(`All ${process.platform === "win32" ? 8 : 10} lifecycle tests passed.`);
