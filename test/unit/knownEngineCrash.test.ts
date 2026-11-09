/**
 * Unit tests for scripts/ci/known-engine-crash.mjs, the cross-version composite's excuse for Godot
 * 4.5.0's macOS export poller crash at boot. Drives knownCrashMismatch on trimmed real `.ips`
 * reports and edits of them, awaitKnownCrash's per-pid verdicts, bounded wait on a fake sleep and
 * report age, and the CLI's output and exit codes.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { awaitKnownCrash, knownCrashMismatch, parseIpsReport } from "../../scripts/ci/known-engine-crash.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(here, "../../scripts/ci/known-engine-crash.mjs");
const fixturesDir = join(here, "../fixtures/crash-reports");

const MONO_BOOT = "macos-4.5.0-mono-boot-poller.ips";
const GDSCRIPT_BOOT = "macos-4.5.0-gdscript-boot-poller.ips";
const boot = { godotVersion: "4.5.0", runnerOs: "macOS" };

function fixtureText(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf8");
}

/** The named fixture, parsed. */
function fixture(name: string): { header: object; body: object } {
  const report = parseIpsReport(fixtureText(name));
  assert.ok(report, `the ${name} fixture parses`);
  return report;
}

/** The part of a report body the edited variants change. */
interface IpsBody {
  exception: { signal: string };
  faultingThread: number;
  threads: { queue?: string; frames: { symbol?: string }[] }[];
}

/** The named fixture, parsed, with its body changed by `edit`. */
function fixtureWith(name: string, edit: (body: IpsBody) => void): { header: object; body: IpsBody } {
  const text = fixtureText(name);
  const newline = text.indexOf("\n");
  const body: IpsBody = JSON.parse(text.slice(newline + 1));
  edit(body);
  return { header: JSON.parse(text.slice(0, newline)), body };
}

/** Drops the main thread's frames whose symbol is `symbol`. */
function withoutMainFrame(symbol: string): (body: IpsBody) => void {
  return (body) => {
    const main = body.threads.find((thread) => thread.queue === "com.apple.main-thread");
    assert.ok(main, "the fixture has a main thread");
    main.frames = main.frames.filter((frame) => frame.symbol !== symbol);
  };
}

/** Writes the named fixture into `dir` as `fileName`, with only its body's `pid` changed. */
function copyWithPid(name: string, dir: string, fileName: string, pid: number): void {
  const text = fixtureText(name);
  const newline = text.indexOf("\n");
  const body = JSON.parse(text.slice(newline + 1));
  body.pid = pid;
  writeFileSync(join(dir, fileName), `${text.slice(0, newline)}\n${JSON.stringify(body, null, 2)}\n`);
}

/** A temp reports folder; removes itself after `body`. */
async function withReportsDir(body: (reportsDir: string) => Promise<void>): Promise<void> {
  const reportsDir = mkdtempSync(join(tmpdir(), "known-crash-"));
  try {
    await body(reportsDir);
  } finally {
    rmSync(reportsDir, { recursive: true, force: true });
  }
}

const noSleep = async (): Promise<void> => {
  throw new Error("no wait expected");
};

{
  assert.equal(
    knownCrashMismatch(fixture(MONO_BOOT), { pid: 7626, ...boot }),
    undefined,
    "a mono editor's poller crash at boot, with the dead attempt's pid, is the known crash",
  );
}

{
  assert.equal(
    knownCrashMismatch(fixture(GDSCRIPT_BOOT), { pid: 6635, ...boot }),
    undefined,
    "a GDScript editor's poller crash at boot, with the dead attempt's pid, is the known crash",
  );
}

{
  assert.equal(
    knownCrashMismatch(fixture("macos-4.5.0-mono-quit-poller.ips"), { pid: 2199, ...boot }),
    "main thread is not joining the poller under DocTools::generate",
    "the same poller crash at quit is not excused",
  );
}

{
  assert.equal(
    knownCrashMismatch(fixture("macos-4.5.0-mono-deliberate-abort.ips"), { pid: 2579, ...boot }),
    "crashing frame is not the export poller",
    "a deliberate abort at boot is not excused",
  );
}

{
  assert.equal(
    knownCrashMismatch(fixture("macos-4.5.0-gdscript-os-crash.ips"), { pid: 2363, ...boot }),
    "crashing frame is not the export poller",
    "an OS.crash at boot is not excused",
  );
}

{
  assert.equal(
    // The 4.5.0 report with only its version changed, since 4.5.2 does not crash.
    knownCrashMismatch(fixture("macos-4.5.0-mono-boot-poller-as-4.5.2.ips"), { pid: 7626, ...boot }),
    "report version 4.5.2",
    "a report from a 4.5.2 editor is not excused, whatever version the caller names",
  );
}

{
  assert.equal(
    knownCrashMismatch(fixture(MONO_BOOT), { pid: 7626, godotVersion: "4.5.2", runnerOs: "macOS" }),
    "Godot 4.5.2 is not 4.5.0",
    "a job on any Godot but 4.5.0 is not excused",
  );
}

{
  assert.equal(
    knownCrashMismatch(fixture(MONO_BOOT), { pid: 7626, godotVersion: "4.5.0", runnerOs: "Linux" }),
    "runner Linux is not macOS",
    "a job off macOS is not excused",
  );
}

{
  assert.equal(
    knownCrashMismatch(fixture(MONO_BOOT), { pid: 999, ...boot }),
    "pid 7626 is not 999",
    "a report of another process does not excuse the attempt",
  );
}

{
  const segfault = fixtureWith(MONO_BOOT, (body) => {
    body.exception.signal = "SIGSEGV";
  });
  assert.equal(
    knownCrashMismatch(segfault, { pid: 7626, ...boot }),
    "signal SIGSEGV",
    "the poller crash's stack on a death by any signal but SIGABRT is not excused",
  );
}

{
  assert.equal(
    knownCrashMismatch(fixtureWith(MONO_BOOT, withoutMainFrame("Thread::wait_to_finish()")), { pid: 7626, ...boot }),
    "main thread is not joining the poller under DocTools::generate",
    "a main thread that is not in Thread::wait_to_finish is not excused",
  );
}

{
  const report = fixtureWith(
    MONO_BOOT,
    withoutMainFrame("EditorExportPlatformAppleEmbedded::~EditorExportPlatformAppleEmbedded()"),
  );
  assert.equal(
    knownCrashMismatch(report, { pid: 7626, ...boot }),
    "main thread is not joining the poller under DocTools::generate",
    "a main thread that is not destroying the export plugin is not excused",
  );
}

{
  const report = fixtureWith(MONO_BOOT, (body) => {
    const frames = body.threads[body.faultingThread].frames;
    const pureVirtual = frames.findIndex((frame) => frame.symbol === "__cxa_pure_virtual");
    assert.ok(pureVirtual >= 0, "the fixture's crashing thread holds __cxa_pure_virtual");
    frames.splice(pureVirtual + 1, 0, { symbol: "Object::notification(int, bool)" });
  });
  assert.equal(
    knownCrashMismatch(report, { pid: 7626, ...boot }),
    "crashing frame is not the export poller",
    "__cxa_pure_virtual called from a frame other than the poll thread is not excused",
  );
}

await withReportsDir(async (reportsDir) => {
  copyWithPid(MONO_BOOT, reportsDir, "Godot-1.ips", 101);
  copyWithPid(GDSCRIPT_BOOT, reportsDir, "Godot-2.ips", 102);
  let elapsed = 0;
  const result = await awaitKnownCrash({
    reportsDir,
    pids: [101, 102, 103],
    ...boot,
    sleep: async (ms: number) => {
      elapsed += ms;
      if (elapsed === 4_000) copyWithPid(MONO_BOOT, reportsDir, "Godot-3.ips", 103);
    },
  });
  assert.equal(result.excused, true, "three boot deaths, each with its known-crash report, are excused");
  assert.deepEqual(
    result.lines,
    [
      "pid 101: known engine crash (Godot-1.ips)",
      "pid 102: known engine crash (Godot-2.ips)",
      "pid 103: known engine crash (Godot-3.ips)",
    ],
    "each pid's line names the report that proves it",
  );
  assert.equal(elapsed, 4_000, "the wait ends at the poll that finds the last report");
});

await withReportsDir(async (reportsDir) => {
  let elapsed = 0;
  const result = await awaitKnownCrash({
    reportsDir,
    pids: [101],
    ...boot,
    sleep: async (ms: number) => {
      elapsed += ms;
    },
  });
  assert.equal(result.excused, false, "a death whose report never arrives is not excused");
  assert.deepEqual(result.lines, ["pid 101: no Godot crash report after 60000 ms"], "the line says nothing came");
  assert.equal(elapsed, 60_000, "the wait stops at its 60 s bound");
});

await withReportsDir(async (reportsDir) => {
  copyWithPid(MONO_BOOT, reportsDir, "Godot-1.ips", 101);
  copyWithPid(GDSCRIPT_BOOT, reportsDir, "Godot-2.ips", 102);
  copyWithPid("macos-4.5.0-gdscript-os-crash.ips", reportsDir, "Godot-3.ips", 103);
  const result = await awaitKnownCrash({ reportsDir, pids: [101, 102, 103], ...boot, maxWaitMs: 0, sleep: noSleep });
  assert.equal(result.excused, false, "two known crashes and one other death are not excused");
  assert.deepEqual(
    result.lines,
    [
      "pid 101: known engine crash (Godot-1.ips)",
      "pid 102: known engine crash (Godot-2.ips)",
      "pid 103: Godot-3.ips: crashing frame is not the export poller",
    ],
    "the unmatched pid's line gives its own report's reason",
  );
});

await withReportsDir(async (reportsDir) => {
  copyWithPid(MONO_BOOT, reportsDir, "Godot-1.ips", 101);
  const result = await awaitKnownCrash({
    reportsDir,
    pids: [101],
    godotVersion: "4.5.0",
    runnerOs: "Linux",
    sleep: noSleep,
  });
  assert.equal(result.excused, false, "a job off macOS is not excused, whatever its reports say");
  assert.deepEqual(result.lines, ["pid 101: runner Linux is not macOS"], "the line names the runner, with no wait");
});

await withReportsDir(async (reportsDir) => {
  copyWithPid(MONO_BOOT, reportsDir, "stacks-1.ips", 101);
  const result = await awaitKnownCrash({ reportsDir, pids: [101], ...boot, maxWaitMs: 0, sleep: noSleep });
  assert.equal(result.excused, false, "an .ips not named for Godot is not read");
  assert.deepEqual(result.lines, ["pid 101: no Godot crash report after 0 ms"], "the line says no report came");
});

await withReportsDir(async (reportsDir) => {
  writeFileSync(join(reportsDir, "Godot-1.ips"), fixtureText(MONO_BOOT).slice(0, 500));
  const result = await awaitKnownCrash({ reportsDir, pids: [7626], ...boot, maxWaitMs: 0, sleep: noSleep });
  assert.equal(result.excused, false, "a report still being written is not excused");
  assert.deepEqual(result.lines, ["pid 7626: no Godot crash report after 0 ms"], "it reads as no report yet");
});

{
  assert.equal(parseIpsReport(fixtureText(MONO_BOOT).slice(0, 500)), undefined, "a half-written report does not parse");
}

await withReportsDir(async (reportsDir) => {
  copyWithPid(MONO_BOOT, reportsDir, "Godot-1.ips", 101);
  const result = await awaitKnownCrash({ reportsDir, pids: [], ...boot, sleep: noSleep });
  assert.equal(result.excused, false, "a boot with no dead attempt is never excused");
  assert.deepEqual(result.lines, [], "it has no pid to report on");
});

// The boot step passes its start in whole seconds; a report is dropped only below that less 1 s.
const BOOT_START_MS = 1_700_000_010_000;

await withReportsDir(async (reportsDir) => {
  copyWithPid(MONO_BOOT, reportsDir, "Godot-1.ips", 101);
  const stale = new Date(1_700_000_008_999);
  utimesSync(join(reportsDir, "Godot-1.ips"), stale, stale);
  const result = await awaitKnownCrash({
    reportsDir,
    pids: [101],
    ...boot,
    maxWaitMs: 0,
    since: BOOT_START_MS,
    sleep: noSleep,
  });
  assert.equal(result.excused, false, "a known-crash report written over 1 s before the boot began is not read");
  assert.deepEqual(result.lines, ["pid 101: no Godot crash report after 0 ms"], "it reads as no report");
});

await withReportsDir(async (reportsDir) => {
  copyWithPid(MONO_BOOT, reportsDir, "Godot-1.ips", 101);
  const edge = new Date(1_700_000_009_000);
  utimesSync(join(reportsDir, "Godot-1.ips"), edge, edge);
  const result = await awaitKnownCrash({
    reportsDir,
    pids: [101],
    ...boot,
    maxWaitMs: 0,
    since: BOOT_START_MS,
    sleep: noSleep,
  });
  assert.equal(result.excused, true, "a known-crash report written exactly 1 s before the boot began is read");
});

await withReportsDir(async (reportsDir) => {
  copyWithPid(MONO_BOOT, reportsDir, "Godot-1.ips", 101);
  const old = new Date(1_000_000_000_000);
  utimesSync(join(reportsDir, "Godot-1.ips"), old, old);
  const result = await awaitKnownCrash({ reportsDir, pids: [101], ...boot, maxWaitMs: 0, sleep: noSleep });
  assert.equal(result.excused, true, "with no boot start given, a report of any age is read");
});

await withReportsDir(async (reportsDir) => {
  copyWithPid(MONO_BOOT, reportsDir, "Godot-1.ips", 101);
  copyWithPid(GDSCRIPT_BOOT, reportsDir, "Godot-2.ips", 102);
  copyWithPid(MONO_BOOT, reportsDir, "Godot-3.ips", 103);
  const run = spawnSync(
    process.execPath,
    [
      scriptPath,
      "--reports",
      reportsDir,
      "--runner-os",
      "macOS",
      "--godot-version",
      "4.5.0",
      "--pid",
      "101",
      "--pid",
      "102",
      "--pid",
      "103",
    ],
    { encoding: "utf8" },
  );
  assert.equal(run.status, 0, `the CLI exits 0 when every death is the known crash: ${run.stderr}`);
  assert.equal(
    run.stdout,
    "pid 101: known engine crash (Godot-1.ips)\n" +
      "pid 102: known engine crash (Godot-2.ips)\n" +
      "pid 103: known engine crash (Godot-3.ips)\n" +
      "known_crash=yes\n",
    "the CLI prints each pid's line, then its verdict",
  );
});

await withReportsDir(async (reportsDir) => {
  copyWithPid(MONO_BOOT, reportsDir, "Godot-1.ips", 101);
  const run = spawnSync(
    process.execPath,
    [
      scriptPath,
      "--reports",
      reportsDir,
      "--runner-os",
      "macOS",
      "--godot-version",
      "4.5.0",
      "--pid",
      "101",
      "--pid",
      "102",
      "--max-wait-ms",
      "0",
    ],
    { encoding: "utf8" },
  );
  assert.equal(run.status, 1, `the CLI exits 1 when a death has no known-crash report: ${run.stderr}`);
  assert.match(
    run.stdout,
    /pid 102: no Godot crash report after 0 ms\nknown_crash=no\n$/,
    "the CLI names the unproven pid, then its verdict",
  );
});

await withReportsDir(async (reportsDir) => {
  copyWithPid(MONO_BOOT, reportsDir, "Godot-1.ips", 101);
  const stale = new Date(1_000_000_000_000);
  utimesSync(join(reportsDir, "Godot-1.ips"), stale, stale);
  const run = spawnSync(
    process.execPath,
    [
      scriptPath,
      "--reports",
      reportsDir,
      "--runner-os",
      "macOS",
      "--godot-version",
      "4.5.0",
      "--pid",
      "101",
      "--max-wait-ms",
      "0",
      "--since",
      "1700000010000",
    ],
    { encoding: "utf8" },
  );
  assert.equal(run.status, 1, `the CLI exits 1 when the only report predates --since: ${run.stderr}`);
  assert.equal(
    run.stdout,
    "pid 101: no Godot crash report after 0 ms\nknown_crash=no\n",
    "the CLI reads the stale report as no report",
  );
});

{
  const missingPid = spawnSync(
    process.execPath,
    [scriptPath, "--reports", "r", "--runner-os", "macOS", "--godot-version", "4.5.0"],
    { encoding: "utf8" },
  );
  assert.equal(missingPid.status, 2, "no --pid is a usage error");
}

{
  const badPid = spawnSync(
    process.execPath,
    [scriptPath, "--reports", "r", "--runner-os", "macOS", "--godot-version", "4.5.0", "--pid", "abc"],
    { encoding: "utf8" },
  );
  assert.equal(badPid.status, 2, "a pid that is not a number is a usage error");
}

await withReportsDir(async (reportsDir) => {
  copyWithPid(MONO_BOOT, reportsDir, "Godot-1.ips", 11);
  const repeated = ["--pid", "11", "--pid", "11", "--pid", "11"];
  const run = spawnSync(
    process.execPath,
    [scriptPath, "--reports", reportsDir, "--runner-os", "macOS", "--godot-version", "4.5.0", ...repeated],
    { encoding: "utf8" },
  );
  assert.equal(run.status, 2, `a pid given more than once is a usage error, not excused by one report: ${run.stdout}`);
});

console.log("All 30 tests passed.");
