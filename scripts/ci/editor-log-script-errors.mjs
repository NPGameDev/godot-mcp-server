// scripts/ci/editor-log-script-errors.mjs
// Fail a cross-version smoke job when its editor log holds a GDScript error raised in
// the toolkit addon. Nothing else checks the log for errors, so without this step an
// addon script error (a renamed engine API, a parse error on a new Godot version)
// still ends the job green. The composite passes editor.log only: the 4.2 warm-up log
// holds the tail of a failed boot attempt, whose transient parse errors are expected, so
// a recovered retry would fail the job.
//
// The rule, per `SCRIPT ERROR:` block (parse errors included, `USER SCRIPT ERROR:` too):
//   • ANSI colour codes are stripped first: macOS editors write them into the log.
//   • A block runs from its header to the next engine error header of any kind
//     (`ERROR:`, `WARNING:`, `SHADER ERROR:`, `SCRIPT ERROR:`, each optionally
//     `USER `-prefixed), so a block whose frame never reached the log cannot take the
//     C++ frame of an entry after it, such as the editor's exit-time errors. Its
//     erroring frame is the first `at: <function> (<file>:<line>)` line in it, at any
//     indent; the message text and the backtrace frames below it are not read.
//   • The block fails when that file is under res://addons/godot_mcp_toolkit/ or is a
//     path-less script (`built-in`, `<built-in>`), and when it has no `at:` line.
// The smoke's own fixtures never live under res://addons/, so no fixture list is kept.
//
// A log cut short would pass with its last blocks unread. Godot 4.2 on Windows
// block-buffers stderr redirected to a file, so an editor killed instead of quit loses
// the tail. The composite therefore has the editor print a sentinel to stderr (twice)
// before it asks the editor to quit, and passes it with `--require-sentinel`: a log
// without one whole copy of it fails as incomplete. The composite passes one of two
// other flags instead when no copy was sent:
//   • `--sentinel-not-sent <reason>`: the editor was already gone or unreachable. The
//     check warns that completeness is unproven rather than add a second failure.
//   • `--sentinel-failed <reason>`: the editor answered and refused, or the stop script
//     broke. The check fails, naming the reason.
//
// Known gaps, by design:
//   • Engine `ERROR:` lines the addon provokes are not gated (some are expected).
//   • On Windows a playtest game's output never reaches the editor log.
//   • A frame line that another writer's output splits after its `at: ` prefix (seen
//     with C# output on Windows) is skipped, so the block's frame is read from a later
//     entry: once a block holds an `at:` line cut short, only the next `SCRIPT ERROR:`
//     header ends it. A split inside the `at: ` prefix itself is not recognised: the
//     block then ends at the next engine header and, with no whole `at:` line before
//     it, fails as frame-less.
//
// Usage: node scripts/ci/editor-log-script-errors.mjs <editor.log> [--if-present <log>]...
//          [--require-sentinel <text> | --sentinel-not-sent <reason> | --sentinel-failed <reason>]
// The first log must exist and hold text; an `--if-present` log is read only when it
// exists; the sentinel is looked for in the first log only. Exit codes: 0 no failure ·
// 1 an offending block, the first log missing or empty, the sentinel missing from it, or
// `--sentinel-failed` · 2 bad arguments.
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Path prefix of every file the toolkit addon ships. */
export const TOOLKIT_ADDON_ROOT = "res://addons/godot_mcp_toolkit/";

const ANSI_COLOUR = /\x1b\[[0-9;]*m/g;
const BLOCK_HEADER = /^(USER )?SCRIPT ERROR:/;
const OTHER_HEADER = /^(USER )?(ERROR|WARNING|SHADER ERROR|UNKNOWN ERROR):/;
const FRAME = /^\s*at: .+ \((.+):\d+\)$/;
const FRAME_START = /^\s*at: /;
const PATHLESS_SCRIPTS = new Set(["built-in", "<built-in>"]);
const INDENTED = /^\s+\S/;

/**
 * The `SCRIPT ERROR` blocks in one log that the gate fails on.
 *
 * @param logText - the whole log, colour codes and Windows line ends included.
 * @returns one entry per offending block, in log order: why it fails and its lines,
 *   from the header through the frame and the indented backtrace below it.
 */
export function findOffendingBlocks(logText) {
  const lines = logText.replace(ANSI_COLOUR, "").split(/\r?\n/);
  const offending = [];
  for (let start = 0; start < lines.length; start++) {
    if (!BLOCK_HEADER.test(lines[start])) continue;
    // Any header ends the block, except that once its own frame line has been cut off,
    // the frame is read from a later entry, so only the next script-error header ends it.
    let end = start + 1;
    let frameSplit = false;
    while (end < lines.length && !BLOCK_HEADER.test(lines[end])) {
      if (!frameSplit && OTHER_HEADER.test(lines[end])) break;
      if (FRAME_START.test(lines[end]) && !FRAME.test(lines[end])) frameSplit = true;
      end++;
    }
    let frameIndex = -1;
    let file = "";
    for (let i = start + 1; i < end; i++) {
      const match = FRAME.exec(lines[i]);
      if (match) {
        frameIndex = i;
        file = match[1];
        break;
      }
    }
    if (frameIndex === -1) {
      offending.push({ reason: "no `at:` line names the erroring frame", lines: printedLines(lines, start, start) });
    } else if (file.startsWith(TOOLKIT_ADDON_ROOT)) {
      offending.push({ reason: `raised in ${file}`, lines: printedLines(lines, start, frameIndex) });
    } else if (PATHLESS_SCRIPTS.has(file)) {
      offending.push({
        reason: `raised in a path-less script (${file})`,
        lines: printedLines(lines, start, frameIndex),
      });
    }
  }
  return offending;
}

// The header through `last`, plus the indented lines after it (the frame's backtrace).
function printedLines(lines, start, last) {
  let end = last + 1;
  while (end < lines.length && INDENTED.test(lines[end]) && !BLOCK_HEADER.test(lines[end])) end++;
  return lines.slice(start, end);
}

/**
 * Reads the logs and judges them.
 *
 * @param requiredLog - the editor log: a missing or empty one fails, because a job
 *   whose log was never read must not pass.
 * @param optionalLogs - logs read only when they exist, such as a warm-up log that
 *   only some Godot versions write.
 * @param requiredSentinel - text the editor wrote to stderr as its last lines before it
 *   was stopped. When given, a required log without one whole copy of it fails as
 *   incomplete. Not checked on a missing or empty log, which already fails.
 * @returns the failures, each with the log it concerns, a reason and the lines to
 *   print, plus an annotation title when the failure is not a script error; empty when
 *   the job passes.
 */
export function checkLogs(requiredLog, optionalLogs = [], requiredSentinel) {
  const failures = [];
  if (!existsSync(requiredLog)) {
    failures.push({ log: requiredLog, reason: "the log is missing", lines: [] });
  } else {
    const text = readFileSync(requiredLog, "utf8");
    if (text.trim() === "") {
      failures.push({ log: requiredLog, reason: "the log is empty", lines: [] });
    } else {
      failures.push(...withLog(requiredLog, findOffendingBlocks(text)));
      if (requiredSentinel !== undefined && !text.includes(requiredSentinel)) {
        failures.push({
          log: requiredLog,
          title: "Editor log incomplete",
          reason: `the stop sentinel ${requiredSentinel} is missing, so the log is incomplete and its last entries were never checked`,
          lines: [],
        });
      }
    }
  }
  for (const log of optionalLogs) {
    if (existsSync(log)) failures.push(...withLog(log, findOffendingBlocks(readFileSync(log, "utf8"))));
  }
  return failures;
}

function withLog(log, blocks) {
  return blocks.map((block) => ({ log, ...block }));
}

function parseArgs(argv) {
  const [requiredLog, ...rest] = argv;
  if (!requiredLog || requiredLog.startsWith("--")) return undefined;
  const optionalLogs = [];
  let requiredSentinel;
  let sentinelNotSent;
  let sentinelFailed;
  let sentinelFlags = 0;
  for (let i = 0; i < rest.length; i += 2) {
    const [flag, value] = [rest[i], rest[i + 1]];
    if (value === undefined) return undefined;
    if (flag === "--if-present") {
      optionalLogs.push(value);
      continue;
    }
    // An empty sentinel would be found in any log.
    if (flag === "--require-sentinel" && value !== "") requiredSentinel = value;
    else if (flag === "--sentinel-not-sent") sentinelNotSent = value;
    else if (flag === "--sentinel-failed") sentinelFailed = value;
    else return undefined;
    sentinelFlags++;
  }
  // The stop step reaches exactly one sentinel outcome.
  if (sentinelFlags > 1) return undefined;
  return { requiredLog, optionalLogs, requiredSentinel, sentinelNotSent, sentinelFailed };
}

function main(argv) {
  const args = parseArgs(argv);
  if (!args) {
    console.error(
      "usage: node scripts/ci/editor-log-script-errors.mjs <editor.log> [--if-present <log>]... " +
        "[--require-sentinel <text> | --sentinel-not-sent <reason> | --sentinel-failed <reason>]",
    );
    return 2;
  }
  if (args.sentinelNotSent !== undefined) {
    console.log(
      `::warning title=Editor log completeness unproven::no stop sentinel was sent (${args.sentinelNotSent}), ` +
        `so ${args.requiredLog} may be missing its last entries`,
    );
  }
  const failures = [];
  if (args.sentinelFailed !== undefined) {
    failures.push({
      log: args.requiredLog,
      title: "Editor stop sentinel failed",
      reason: `the editor did not take the stop sentinel (${args.sentinelFailed}), so the log's completeness is unproven`,
      lines: [],
    });
  }
  failures.push(...checkLogs(args.requiredLog, args.optionalLogs, args.requiredSentinel));
  const read = [args.requiredLog, ...args.optionalLogs.filter((log) => existsSync(log))].join(", ");
  if (failures.length === 0) {
    const sentinelNote = args.requiredSentinel === undefined ? "" : "; stop sentinel found";
    console.log(`PASS  no script error raised in ${TOOLKIT_ADDON_ROOT} (read ${read}${sentinelNote})`);
    return 0;
  }
  for (const failure of failures) {
    // A workflow command, so each failure also shows as an annotation on the run.
    console.log(`::error title=${failure.title ?? "Addon script error"}::${failure.log}: ${failure.reason}`);
    for (const line of failure.lines) console.log(`    ${line}`);
  }
  console.log(`FAIL  ${failures.length} failure(s) in ${read}`);
  return 1;
}

// Real paths on both sides: a symlinked checkout must not skip the run, since a skipped
// run exits 0 and passes the job.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2));
}
