// scripts/ci/collect-crash-reports.mjs
// Gather one cross-version job's crash evidence into the folder the composite uploads. An
// artifact on a public repo can be downloaded by any GitHub account and the editor process
// holds the WS auth token, so only text and minimal reports go in: the editor logs, the
// Godot `.ips` reports on macOS, the Godot minidumps on Windows, and on Linux the text of
// `gdb -batch -ex bt` run here on the runner. A core file is the process's memory and is
// never copied. docs/dev/crash-reports.md explains how to read what this gathers.
//
// The OS reporter writes on its own schedule, so when an editor is expected to have died
// (a failed leg, or an editor gone at teardown) the macOS and Windows reports get a bounded
// wait. A green leg waits for nothing.
//
// It writes `upload=true|false` to $GITHUB_OUTPUT. The leg uploads when there is a report,
// a log of a failed boot attempt, a failed or cancelled leg, or an editor gone at teardown;
// otherwise the leg's job log already says everything.
//
// Usage: node scripts/ci/collect-crash-reports.mjs --os <linux|macos|windows> --out <dir>
//          --reports <dir> [--editor-bin <path>] [--leg-status <status>]
//          [--editor-gone <reason>] [--log <file>]...
// Exit codes: 0 gathered, a report or not · 1 an unexpected error (the composite's step
// continues on error, so it cannot fail the leg) · 2 bad arguments.
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const REPORT_NAME = {
  macos: /^godot.*\.ips$/i,
  // LocalDumps is machine-wide and names a dump after its executable; a dump of any other
  // process (node holds the token in the dispatch leg) stays on the runner.
  windows: /^godot.*\.dmp$/i,
};
const CORE_NAME = /^core\./;
const FAILED_BOOT_LOG = /^editor-attempt-/;

// A minimal dump is stacks and modules. One far past this is not minimal, whatever the
// registry was asked for, so it stays on the runner.
const MAX_REPORT_BYTES = 64 * 1024 * 1024;

const POLL_MS = 2_000;
// The reports of a boot's three attempts arrive one by one: stop once none has come for this long.
const SETTLE_MS = 15_000;
const MAX_WAIT_MS = 60_000;

const GDB_TIMEOUT_MS = 120_000;
const APT_TIMEOUT_MS = 240_000;

/**
 * Whether the leg's state says an editor may have died, which is worth waiting for a report.
 *
 * @param legStatus - the composite's result so far: `success`, `failure` or `cancelled`.
 * @param editorGone - why the teardown found no editor to stop; empty when it found one.
 */
export function expectsEditorDeath(legStatus, editorGone) {
  return legStatus === "failure" || legStatus === "cancelled" || Boolean(editorGone);
}

/**
 * Gathers the logs and the OS's reports into `outDir`, with a `collected.txt` saying what
 * it found, so an artifact without a report explains itself.
 *
 * @param options.os - `linux`, `macos` or `windows`.
 * @param options.outDir - the folder the composite uploads.
 * @param options.reportsDir - where this OS's reporter writes.
 * @param options.logs - logs to copy; one the job never wrote is noted and skipped.
 * @param options.expectDeath - wait for a macOS or Windows report to arrive.
 * @param options.backtrace - returns a Linux core's backtrace as text.
 * @param options.sleep - waits the given ms, or a test's stand-in.
 * @returns how many reports were gathered, whether to upload, and the notes.
 */
export async function collectCrashReports({ os, outDir, reportsDir, logs, expectDeath, backtrace, sleep = pause }) {
  mkdirSync(outDir, { recursive: true });
  const notes = [];
  for (const log of logs) {
    if (!existsSync(log)) {
      notes.push(`${log}: not written by this job`);
      continue;
    }
    copyFileSync(log, join(outDir, basename(log)));
  }
  const reports =
    os === "linux"
      ? writeBacktraces(reportsDir, outDir, backtrace, notes)
      : await copyReports(REPORT_NAME[os], reportsDir, outDir, expectDeath, sleep, notes);
  const failedBoots = readdirSync(outDir).filter((name) => FAILED_BOOT_LOG.test(name)).length;
  notes.push(`reports gathered: ${reports}; failed boot attempts logged: ${failedBoots}`);
  writeFileSync(join(outDir, "collected.txt"), `${notes.join("\n")}\n`);
  return { reports, upload: reports > 0 || failedBoots > 0 || expectDeath, notes };
}

function listDir(dir) {
  return existsSync(dir) ? readdirSync(dir) : [];
}

function writeBacktraces(coreDir, outDir, backtrace, notes) {
  const cores = listDir(coreDir).filter((name) => CORE_NAME.test(name));
  for (const name of cores) {
    writeFileSync(join(outDir, `${name}.backtrace.txt`), backtrace(join(coreDir, name)));
  }
  notes.push(`${coreDir}: ${cores.length} core file(s), read on the runner and not uploaded`);
  return cores.length;
}

async function copyReports(pattern, reportsDir, outDir, expectDeath, sleep, notes) {
  const list = () => listDir(reportsDir).filter((name) => pattern.test(name));
  let names = list();
  let waitedMs = 0;
  let quietMs = 0;
  while (expectDeath && waitedMs < MAX_WAIT_MS && !(names.length > 0 && quietMs >= SETTLE_MS)) {
    await sleep(POLL_MS);
    waitedMs += POLL_MS;
    const current = list();
    quietMs = current.length === names.length ? quietMs + POLL_MS : 0;
    names = current;
  }
  let copied = 0;
  for (const name of names) {
    const path = join(reportsDir, name);
    const bytes = statSync(path).size;
    if (bytes > MAX_REPORT_BYTES) {
      notes.push(`${name}: left on the runner, ${bytes} bytes is not a minimal report`);
      continue;
    }
    copyFileSync(path, join(outDir, name));
    copied++;
  }
  notes.push(
    `${reportsDir}: ${names.length} report(s) after waiting ${waitedMs} ms; all files there: ${listDir(reportsDir).length}`,
  );
  return copied;
}

// The apt fetch is spent only on a leg that has a core to read.
function ensureGdb() {
  if (!spawnSync("gdb", ["--version"], { stdio: "ignore" }).error) return "gdb was already installed";
  const apt = ["-o", "DPkg::Lock::Timeout=60", "-y"];
  for (const step of [["update"], ["install", "--no-install-recommends", "gdb"]]) {
    const run = spawnSync("sudo", ["apt-get", ...apt, ...step], { stdio: "ignore", timeout: APT_TIMEOUT_MS });
    if (run.status !== 0) return `apt-get ${step[0]} failed (status ${run.status}, ${run.error ?? "no error"})`;
  }
  return "gdb installed through apt";
}

function gdbBacktrace(editorBin, core) {
  const args = ["-batch", "-ex", "bt", ...(editorBin ? [editorBin] : []), "-c", core];
  const run = spawnSync("gdb", args, { encoding: "utf8", timeout: GDB_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 });
  if (run.error) return `gdb did not finish: ${run.error}\n${run.stdout ?? ""}`;
  return `${run.stdout}${run.stderr}`;
}

function parseArgs(argv) {
  const args = { logs: [], editorBin: "", legStatus: "", editorGone: "" };
  const flags = {
    "--os": "os",
    "--out": "outDir",
    "--reports": "reportsDir",
    "--editor-bin": "editorBin",
    "--leg-status": "legStatus",
    "--editor-gone": "editorGone",
  };
  for (let i = 0; i < argv.length; i += 2) {
    const [flag, value] = [argv[i], argv[i + 1]];
    if (value === undefined) return undefined;
    if (flag === "--log") args.logs.push(value);
    else if (flag in flags) args[flags[flag]] = value;
    else return undefined;
  }
  const known = args.os === "linux" || args.os === "macos" || args.os === "windows";
  return known && args.outDir && args.reportsDir ? args : undefined;
}

async function main(argv) {
  const args = parseArgs(argv);
  if (!args) {
    console.error(
      "usage: node scripts/ci/collect-crash-reports.mjs --os <linux|macos|windows> --out <dir> --reports <dir> " +
        "[--editor-bin <path>] [--leg-status <status>] [--editor-gone <reason>] [--log <file>]...",
    );
    return 2;
  }
  let gdbNote;
  const backtrace = (core) => {
    gdbNote ??= ensureGdb();
    return `${gdbNote}\n${gdbBacktrace(args.editorBin, core)}`;
  };
  const { reports, upload, notes } = await collectCrashReports({
    os: args.os,
    outDir: args.outDir,
    reportsDir: args.reportsDir,
    logs: args.logs,
    expectDeath: expectsEditorDeath(args.legStatus, args.editorGone),
    backtrace,
  });
  for (const note of notes) console.log(note);
  if (reports > 0) {
    console.log(
      `::warning title=Crash report::${reports} editor crash report(s) gathered; see docs/dev/crash-reports.md`,
    );
  }
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `upload=${upload}\n`);
  return 0;
}

// Real paths on both sides, so a symlinked checkout still runs the script.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = await main(process.argv.slice(2));
}
