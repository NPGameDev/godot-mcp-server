/**
 * Unit tests for scripts/ci/collect-crash-reports.mjs, the cross-version composite's gathering
 * of editor crash evidence. Drives what enters the upload folder per OS, the bounded wait for a
 * late report on a fake sleep, the upload decision, and the CLI's output and exit codes.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { collectCrashReports, expectsEditorDeath } from "../../scripts/ci/collect-crash-reports.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(here, "../../scripts/ci/collect-crash-reports.mjs");

/** A temp root with an empty reports folder and an upload folder path; removes itself after `body`. */
async function withDirs(body: (reportsDir: string, outDir: string, root: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "collect-crash-"));
  const reportsDir = join(root, "reports");
  mkdirSync(reportsDir);
  try {
    await body(reportsDir, join(root, "out"), root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const noBacktrace = (core: string): string => {
  throw new Error(`no core expected, got ${core}`);
};
const noSleep = async (): Promise<void> => {
  throw new Error("no wait expected");
};
/** Env that points the CLI's cdb lookup at a folder without one, whatever this host has installed. */
const noCdb = (root: string): NodeJS.ProcessEnv => ({ "ProgramFiles(x86)": root });

await withDirs(async (reportsDir, outDir) => {
  writeFileSync(join(reportsDir, "Godot-2026-11-09-101500.ips"), "{}");
  writeFileSync(join(reportsDir, "node-2026-11-09-101500.ips"), "{}");
  writeFileSync(join(reportsDir, "stacks-2026-11-09-101500.ips"), "{}");
  const result = await collectCrashReports({
    os: "macos",
    outDir,
    reportsDir,
    logs: [],
    expectDeath: false,
    backtrace: noBacktrace,
    sleep: noSleep,
  });
  assert.equal(result.reports, 1, "macOS: one Godot report gathered");
  assert.deepEqual(
    readdirSync(outDir).sort(),
    ["Godot-2026-11-09-101500.ips", "collected.txt"],
    "macOS: another process's .ips stays out of the upload",
  );
});

await withDirs(async (reportsDir, outDir) => {
  writeFileSync(join(reportsDir, "godot.4242.dmp"), "MDMP");
  writeFileSync(join(reportsDir, "Godot_v4.5-stable_mono_win64.exe.4243.dmp"), "MDMP");
  writeFileSync(join(reportsDir, "node.exe.4244.dmp"), "MDMP");
  const read: string[] = [];
  const result = await collectCrashReports({
    os: "windows",
    outDir,
    reportsDir,
    logs: [],
    expectDeath: false,
    backtrace: (dump: string) => {
      read.push(dump);
      return "STACK_TEXT:\n";
    },
    sleep: noSleep,
  });
  assert.equal(result.reports, 2, "Windows: both names of the editor's executable count");
  assert.equal(existsSync(join(outDir, "node.exe.4244.dmp")), false, "Windows: another process's dump stays out");
  assert.deepEqual(
    read.sort(),
    [join(reportsDir, "Godot_v4.5-stable_mono_win64.exe.4243.dmp"), join(reportsDir, "godot.4242.dmp")],
    "Windows: only the editor's dumps are read, where they lie",
  );
  assert.deepEqual(
    readdirSync(outDir).sort(),
    ["Godot_v4.5-stable_mono_win64.exe.4243.cdb.txt", "collected.txt", "godot.4242.cdb.txt"],
    "Windows: the stack text enters the upload and no dump does",
  );
  assert.equal(readFileSync(join(outDir, "godot.4242.cdb.txt"), "utf8"), "STACK_TEXT:\n", "stack text kept");
  assert.equal(existsSync(join(reportsDir, "godot.4242.dmp")), true, "Windows: the dump stays on the runner");
});

await withDirs(async (reportsDir, outDir) => {
  writeFileSync(join(reportsDir, "core.godot.77.6"), "process memory");
  const read: string[] = [];
  const result = await collectCrashReports({
    os: "linux",
    outDir,
    reportsDir,
    logs: [],
    expectDeath: false,
    backtrace: (core: string) => {
      read.push(core);
      return "#0 abort ()\n";
    },
    sleep: noSleep,
  });
  assert.deepEqual(read, [join(reportsDir, "core.godot.77.6")], "Linux: the core is read where it lies");
  assert.equal(result.reports, 1, "Linux: a backtrace counts as the report");
  assert.deepEqual(
    readdirSync(outDir).sort(),
    ["collected.txt", "core.godot.77.6.backtrace.txt"],
    "Linux: the backtrace enters the upload and the core does not",
  );
  assert.equal(
    readFileSync(join(outDir, "core.godot.77.6.backtrace.txt"), "utf8"),
    "#0 abort ()\n",
    "backtrace text kept",
  );
  assert.equal(existsSync(join(reportsDir, "core.godot.77.6")), true, "Linux: the core stays on the runner");
});

await withDirs(async (reportsDir, outDir, root) => {
  writeFileSync(join(reportsDir, "Godot.1.dmp"), Buffer.alloc(64 * 1024 * 1024 + 1));
  const log = join(root, "editor.log");
  writeFileSync(log, "banner\n");
  const result = await collectCrashReports({
    os: "windows",
    outDir,
    reportsDir,
    logs: [log, join(root, "warmup.log")],
    expectDeath: false,
    backtrace: noBacktrace,
    sleep: noSleep,
  });
  assert.equal(result.reports, 0, "a dump past the cap does not count as gathered");
  assert.equal(existsSync(join(outDir, "Godot.1.dmp")), false, "a dump past the cap stays on the runner");
  const collected = readFileSync(join(outDir, "collected.txt"), "utf8");
  assert.match(collected, /Godot\.1\.dmp: left on the runner/, "collected.txt says the dump was left behind");
  assert.match(collected, /warmup\.log: not written by this job/, "collected.txt says which log never existed");
  assert.equal(readFileSync(join(outDir, "editor.log"), "utf8"), "banner\n", "an existing log is copied");
  assert.equal(result.upload, false, "only a clean log and no death: nothing to upload");
});

await withDirs(async (reportsDir, outDir) => {
  const reportArrives = [4_000, 8_000];
  let elapsed = 0;
  const result = await collectCrashReports({
    os: "macos",
    outDir,
    reportsDir,
    logs: [],
    expectDeath: true,
    backtrace: noBacktrace,
    sleep: async (ms: number) => {
      elapsed += ms;
      for (const at of reportArrives) {
        if (elapsed === at) writeFileSync(join(reportsDir, `Godot-${at}.ips`), "{}");
      }
    },
  });
  assert.equal(result.reports, 2, "reports arriving during the wait are gathered, the later one too");
  assert.equal(elapsed, 24_000, "the wait ends 15 s after the last arrival, on the 2 s poll");
});

await withDirs(async (reportsDir, outDir) => {
  writeFileSync(join(reportsDir, "Godot-early.ips"), "{}");
  let elapsed = 0;
  const result = await collectCrashReports({
    os: "macos",
    outDir,
    reportsDir,
    logs: [],
    expectDeath: true,
    backtrace: noBacktrace,
    sleep: async (ms: number) => {
      elapsed += ms;
      if (elapsed === 18_000) writeFileSync(join(reportsDir, "Godot-slow.ips"), "{}");
    },
  });
  assert.equal(result.reports, 2, "a report 18 s into the wait is gathered though an earlier one went quiet at once");
  assert.equal(elapsed, 34_000, "the wait then ends 15 s after that arrival, on the 2 s poll");
});

await withDirs(async (reportsDir, outDir) => {
  writeFileSync(join(reportsDir, "Godot-early.ips"), "{}");
  let elapsed = 0;
  await collectCrashReports({
    os: "macos",
    outDir,
    reportsDir,
    logs: [],
    expectDeath: true,
    backtrace: noBacktrace,
    sleep: async (ms: number) => {
      elapsed += ms;
    },
  });
  assert.equal(elapsed, 24_000, "a report already there still holds the wait 24 s for a slower one");
});

await withDirs(async (reportsDir, outDir) => {
  let elapsed = 0;
  const result = await collectCrashReports({
    os: "windows",
    outDir,
    reportsDir,
    logs: [],
    expectDeath: true,
    backtrace: noBacktrace,
    sleep: async (ms: number) => {
      elapsed += ms;
    },
  });
  assert.equal(elapsed, 60_000, "no report: the wait stops at its 60 s bound");
  assert.equal(result.reports, 0, "no report: none gathered");
  assert.equal(result.upload, true, "an expected death uploads without a report, so its logs still leave the runner");
  assert.match(
    readFileSync(join(outDir, "collected.txt"), "utf8"),
    /0 report\(s\) after waiting 60000 ms/,
    "the wait is logged",
  );
});

await withDirs(async (reportsDir, outDir, root) => {
  mkdirSync(outDir);
  writeFileSync(join(outDir, "editor-attempt-1.log"), "boot 1\n");
  const result = await collectCrashReports({
    os: "linux",
    outDir,
    reportsDir: join(root, "no-such-core-dir"),
    logs: [],
    expectDeath: false,
    backtrace: noBacktrace,
    sleep: noSleep,
  });
  assert.equal(result.reports, 0, "a recovered boot on a missing core folder: no report");
  assert.equal(result.upload, true, "a recovered boot's failed attempt uploads on a green leg");
});

{
  assert.equal(expectsEditorDeath("success", ""), false, "a green leg with an editor to stop expects no death");
  assert.equal(expectsEditorDeath("failure", ""), true, "a failed leg may hold a death");
  assert.equal(expectsEditorDeath("cancelled", ""), true, "a cancelled leg may hold a death");
  assert.equal(expectsEditorDeath("success", "already exited"), true, "an editor gone at teardown is a death");
}

await withDirs(async (reportsDir, outDir, root) => {
  writeFileSync(join(reportsDir, "Godot.9.dmp"), "MDMP");
  const output = join(root, "github-output");
  const run = spawnSync(
    process.execPath,
    [
      scriptPath,
      "--os",
      "windows",
      "--out",
      outDir,
      "--reports",
      reportsDir,
      "--leg-status",
      "success",
      "--editor-gone",
      "",
    ],
    { encoding: "utf8", env: { ...process.env, GITHUB_OUTPUT: output, ...noCdb(root) } },
  );
  assert.equal(run.status, 0, `the CLI exits 0 with a report: ${run.stderr}`);
  assert.equal(readFileSync(output, "utf8"), "upload=true\n", "the CLI writes the upload decision to GITHUB_OUTPUT");
  assert.match(run.stdout, /::warning title=Crash report::1 editor crash report/, "a report raises an annotation");
});

await withDirs(async (reportsDir, outDir, root) => {
  writeFileSync(join(reportsDir, "godot.9.dmp"), "MDMP");
  const run = spawnSync(
    process.execPath,
    [scriptPath, "--os", "windows", "--out", outDir, "--reports", reportsDir, "--leg-status", "success"],
    { encoding: "utf8", env: { ...process.env, GITHUB_OUTPUT: join(root, "github-output"), ...noCdb(root) } },
  );
  assert.equal(run.status, 0, `no cdb on the runner never fails a leg: ${run.stderr}`);
  assert.match(run.stdout, /cdb is not at .*cdb\.exe/, "no cdb: the job log says so");
  assert.deepEqual(
    readdirSync(outDir).sort(),
    ["collected.txt", "godot.9.cdb.txt"],
    "no cdb: the text explains itself and the dump still stays out of the upload",
  );
  assert.match(
    readFileSync(join(outDir, "godot.9.cdb.txt"), "utf8"),
    /cdb is not at .*cdb\.exe/,
    "no cdb: the artifact says so",
  );
});

await withDirs(async (reportsDir, outDir, root) => {
  const output = join(root, "github-output");
  const run = spawnSync(
    process.execPath,
    [scriptPath, "--os", "macos", "--out", outDir, "--reports", reportsDir, "--leg-status", "success"],
    { encoding: "utf8", env: { ...process.env, GITHUB_OUTPUT: output } },
  );
  assert.equal(run.status, 0, `the CLI exits 0 without a report, so no report never fails a leg: ${run.stderr}`);
  assert.equal(readFileSync(output, "utf8"), "upload=false\n", "a green leg with nothing to say uploads nothing");
});

{
  const run = spawnSync(process.execPath, [scriptPath, "--os", "beos", "--out", "o", "--reports", "r"], {
    encoding: "utf8",
  });
  assert.equal(run.status, 2, "an unknown OS is a usage error");
}

console.log("All 14 tests passed.");
