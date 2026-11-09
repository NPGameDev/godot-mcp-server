// scripts/ci/known-engine-crash.mjs
// Say whether every boot attempt the cross-version composite saw die was Godot 4.5.0's known
// macOS crash. On that version the iOS and visionOS export plugins start a device poll thread on
// macOS, and the editor can abort while destroying them as it generates its docs at boot
// (`Pure virtual function called!`); Godot 4.5.1 fixed it. A death is excused only when its own
// `.ips` report, tied to it by pid, shows that crash, so any other death still fails the job.
//
// macOS's reporter writes a report some seconds after the process is gone, so the wait for the
// reports is bounded here.
//
// Usage: node scripts/ci/known-engine-crash.mjs --reports <dir> --runner-os <os>
//          --godot-version <version> --pid <n>... [--max-wait-ms <n>] [--since <epoch-ms>]
// It prints one line per pid, then `known_crash=yes|no`. With `--since`, a report whose file was
// last modified more than 1 s before that time is not read, so an older crash cannot stand in for
// one of these deaths.
// Exit codes: 0 every pid died of the known crash · 1 not · 2 bad arguments, a repeated pid among them.
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { REPORT_NAME } from "./collect-crash-reports.mjs";

const POLL_MS = 2_000;
// About three times the slowest report latency seen on a hosted macOS runner.
const MAX_WAIT_MS = 60_000;
// A defensive margin for file timestamp granularity. The boot step passes the whole second it began
// in, as `date +%s` truncates, so the cutoff falls 1 s before that second.
const SINCE_SLACK_MS = 1_000;

const EXCUSED_OS = "macOS";
const EXCUSED_GODOT = "4.5.0";
// 4.5.0's bundle version; 4.5.2's reads `4.5.2`.
const EXCUSED_BUNDLE_VERSION = "4.5";

const MAIN_QUEUE = "com.apple.main-thread";
const PURE_VIRTUAL = "__cxa_pure_virtual";
const POLL_THREAD = "EditorExportPlatformAppleEmbedded::_check_for_changes_poll_thread(void*)";
// The main thread joins the poll thread while destroying the export plugin, under the doc
// generation the editor runs before any addon code. The same crash at quit joins under other
// frames, and an editor that quits during boot for another reason must stay a failure.
const BOOT_JOIN = [
  (symbol) => symbol === "Thread::wait_to_finish()",
  (symbol) => symbol === "EditorExportPlatformAppleEmbedded::~EditorExportPlatformAppleEmbedded()",
  (symbol) => symbol.startsWith("DocTools::generate("),
];

/**
 * Splits a macOS crash report into its two JSON documents: a one-line header, then the body.
 *
 * @param text - the `.ips` file's text.
 * @returns the parsed header and body, or `undefined` when either is not a JSON object, as in a
 *   report the reporter is still writing.
 */
export function parseIpsReport(text) {
  const newline = text.indexOf("\n");
  if (newline < 0) return undefined;
  try {
    const header = JSON.parse(text.slice(0, newline));
    const body = JSON.parse(text.slice(newline + 1));
    return isObject(header) && isObject(body) ? { header, body } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Says why a crash report is not Godot 4.5.0's export poller crash for one dead boot attempt.
 *
 * @param report - a report from {@link parseIpsReport}.
 * @param attempt.pid - the dead editor's process id.
 * @param attempt.godotVersion - the Godot version the job installed, as `4.5.0`.
 * @param attempt.runnerOs - the runner's OS as GitHub Actions names it, as `macOS`.
 * @returns `undefined` when the report is that crash, else the first check it fails.
 */
export function knownCrashMismatch(report, { pid, godotVersion, runnerOs }) {
  const outOfScope = scopeMismatch(godotVersion, runnerOs);
  if (outOfScope) return outOfScope;
  const { body } = report;
  if (body.pid !== pid) return `pid ${body.pid} is not ${pid}`;
  const version = body.bundleInfo?.CFBundleShortVersionString;
  if (version !== EXCUSED_BUNDLE_VERSION) return `report version ${version}`;
  const signal = body.exception?.signal;
  if (signal !== "SIGABRT") return `signal ${signal}`;
  const threads = Array.isArray(body.threads) ? body.threads : [];
  const crashing = symbolsOf(threads[body.faultingThread]);
  if (!crashing.some((symbol, i) => symbol === PURE_VIRTUAL && crashing[i + 1] === POLL_THREAD)) {
    return "crashing frame is not the export poller";
  }
  if (!inOrder(symbolsOf(threads.find((thread) => thread?.queue === MAIN_QUEUE)), BOOT_JOIN)) {
    return "main thread is not joining the poller under DocTools::generate";
  }
  return undefined;
}

/**
 * Waits for each dead boot attempt's crash report and says whether every one is the known crash.
 *
 * @param options.reportsDir - where macOS's reporter writes.
 * @param options.pids - the dead attempts' process ids; a list naming one twice is never excused.
 * @param options.godotVersion - the Godot version the job installed.
 * @param options.runnerOs - the runner's OS as GitHub Actions names it.
 * @param options.maxWaitMs - how long to wait for a report still to be written.
 * @param options.since - when given, the epoch ms the boot began: a report whose file was last
 *   modified more than a second before it is not read.
 * @param options.sleep - waits the given ms, or a test's stand-in.
 * @returns whether every pid is excused, and one line per pid saying why.
 */
export async function awaitKnownCrash({
  reportsDir,
  pids,
  godotVersion,
  runnerOs,
  maxWaitMs = MAX_WAIT_MS,
  since,
  sleep = pause,
}) {
  const outOfScope = scopeMismatch(godotVersion, runnerOs);
  if (outOfScope) return { excused: false, lines: pids.map((pid) => `pid ${pid}: ${outOfScope}`) };
  // One report would otherwise excuse a pid named three times.
  if (new Set(pids).size !== pids.length) {
    return { excused: false, lines: pids.map((pid) => `pid ${pid}: the pid list names a pid more than once`) };
  }
  const attempt = { godotVersion, runnerOs };
  let verdicts = judge(readReports(reportsDir, since), pids, attempt);
  let waitedMs = 0;
  while (verdicts.some((verdict) => !verdict.matched) && waitedMs < maxWaitMs) {
    await sleep(POLL_MS);
    waitedMs += POLL_MS;
    verdicts = judge(readReports(reportsDir, since), pids, attempt);
  }
  return {
    // No death means nothing to excuse.
    excused: pids.length > 0 && verdicts.every((verdict) => verdict.matched),
    lines: verdicts.map(({ pid, why }) => `pid ${pid}: ${why ?? `no Godot crash report after ${waitedMs} ms`}`),
  };
}

function scopeMismatch(godotVersion, runnerOs) {
  if (runnerOs !== EXCUSED_OS) return `runner ${runnerOs} is not ${EXCUSED_OS}`;
  if (godotVersion !== EXCUSED_GODOT) return `Godot ${godotVersion} is not ${EXCUSED_GODOT}`;
  return undefined;
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function symbolsOf(thread) {
  if (!Array.isArray(thread?.frames)) return [];
  return thread.frames.map((frame) => (typeof frame?.symbol === "string" ? frame.symbol : ""));
}

function inOrder(symbols, steps) {
  let next = 0;
  for (const symbol of symbols) {
    if (next < steps.length && steps[next](symbol)) next += 1;
  }
  return next === steps.length;
}

// A report that does not parse yet is skipped, and read again on the next poll. The age test reads
// the file's mtime rather than a time inside the report, so it holds before the report parses.
function readReports(reportsDir, since) {
  const names = existsSync(reportsDir) ? readdirSync(reportsDir) : [];
  return names
    .filter((name) => REPORT_NAME.macos.test(name))
    .filter((name) => since === undefined || statSync(join(reportsDir, name)).mtimeMs >= since - SINCE_SLACK_MS)
    .flatMap((name) => {
      const report = parseIpsReport(readFileSync(join(reportsDir, name), "utf8"));
      return report ? [{ name, report }] : [];
    });
}

// Every report is checked against every pid, so the pid check decides which death a report proves.
// The reason shown for an unmatched pid is that of a report carrying its pid.
function judge(reports, pids, attempt) {
  return pids.map((pid) => {
    const checked = reports.map(({ name, report }) => ({
      name,
      own: report.body.pid === pid,
      reason: knownCrashMismatch(report, { pid, ...attempt }),
    }));
    const match = checked.find(({ reason }) => reason === undefined);
    if (match) return { pid, matched: true, why: `known engine crash (${match.name})` };
    const own = checked.find((check) => check.own);
    return { pid, matched: false, why: own && `${own.name}: ${own.reason}` };
  });
}

function parseArgs(argv) {
  const args = { pids: [], maxWaitMs: MAX_WAIT_MS };
  const flags = { "--reports": "reportsDir", "--runner-os": "runnerOs", "--godot-version": "godotVersion" };
  for (let i = 0; i < argv.length; i += 2) {
    const [flag, value] = [argv[i], argv[i + 1]];
    if (value === undefined) return undefined;
    if (flag === "--pid" || flag === "--max-wait-ms" || flag === "--since") {
      if (!/^\d+$/.test(value)) return undefined;
      const number = Number(value);
      if (flag === "--pid") {
        // One report would otherwise excuse a pid named three times.
        if (args.pids.includes(number)) return undefined;
        args.pids.push(number);
      } else if (flag === "--max-wait-ms") {
        args.maxWaitMs = number;
      } else {
        args.since = number;
      }
    } else if (Object.hasOwn(flags, flag)) {
      args[flags[flag]] = value;
    } else {
      return undefined;
    }
  }
  return args.reportsDir && args.runnerOs && args.godotVersion && args.pids.length > 0 ? args : undefined;
}

async function main(argv) {
  const args = parseArgs(argv);
  if (!args) {
    console.error(
      "usage: node scripts/ci/known-engine-crash.mjs --reports <dir> --runner-os <os> " +
        "--godot-version <version> --pid <n>... [--max-wait-ms <n>] [--since <epoch-ms>]",
    );
    return 2;
  }
  const { excused, lines } = await awaitKnownCrash(args);
  for (const line of lines) console.log(line);
  console.log(`known_crash=${excused ? "yes" : "no"}`);
  return excused ? 0 : 1;
}

// Real paths on both sides, so a symlinked checkout still runs the script.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = await main(process.argv.slice(2));
}
