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
//   • A block runs from its header to the next header. Its erroring frame is the
//     first `at: <function> (<file>:<line>)` line in it, at any indent; the message
//     text and the backtrace frames below it are not read.
//   • The block fails when that file is under res://addons/godot_mcp_toolkit/ or is a
//     path-less script (`built-in`, `<built-in>`), and when it has no `at:` line.
// The smoke's own fixtures never live under res://addons/, so no fixture list is kept.
//
// Known gaps, by design:
//   • Engine `ERROR:` lines the addon provokes are not gated (some are expected).
//   • On Windows a playtest game's output never reaches the editor log.
//   • A frame line that another writer's output splits (seen with C# output on
//     Windows) is skipped, so the block's frame is read from a later entry.
//
// Usage: node scripts/ci/editor-log-script-errors.mjs <editor.log> [--if-present <log>]...
// The first log must exist and hold text; an `--if-present` log is read only when it
// exists. Exit codes: 0 no offending block · 1 an offending block, or the first log is
// missing or empty · 2 bad arguments.
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Path prefix of every file the toolkit addon ships. */
export const TOOLKIT_ADDON_ROOT = "res://addons/godot_mcp_toolkit/";

const ANSI_COLOUR = /\x1b\[[0-9;]*m/g;
const BLOCK_HEADER = /^(USER )?SCRIPT ERROR:/;
const FRAME = /^\s*at: .+ \((.+):\d+\)$/;
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
    let end = start + 1;
    while (end < lines.length && !BLOCK_HEADER.test(lines[end])) end++;
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
 * @returns the failures, each with the log it concerns, a reason and the lines to
 *   print; empty when the job passes.
 */
export function checkLogs(requiredLog, optionalLogs = []) {
  const failures = [];
  if (!existsSync(requiredLog)) {
    failures.push({ log: requiredLog, reason: "the log is missing", lines: [] });
  } else {
    const text = readFileSync(requiredLog, "utf8");
    if (text.trim() === "") failures.push({ log: requiredLog, reason: "the log is empty", lines: [] });
    else failures.push(...withLog(requiredLog, findOffendingBlocks(text)));
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
  for (let i = 0; i < rest.length; i += 2) {
    if (rest[i] !== "--if-present" || rest[i + 1] === undefined) return undefined;
    optionalLogs.push(rest[i + 1]);
  }
  return { requiredLog, optionalLogs };
}

function main(argv) {
  const args = parseArgs(argv);
  if (!args) {
    console.error("usage: node scripts/ci/editor-log-script-errors.mjs <editor.log> [--if-present <log>]...");
    return 2;
  }
  const failures = checkLogs(args.requiredLog, args.optionalLogs);
  const read = [args.requiredLog, ...args.optionalLogs.filter((log) => existsSync(log))].join(", ");
  if (failures.length === 0) {
    console.log(`PASS  no script error raised in ${TOOLKIT_ADDON_ROOT} (read ${read})`);
    return 0;
  }
  for (const failure of failures) {
    // A workflow command, so each failure also shows as an annotation on the run.
    console.log(`::error title=Addon script error::${failure.log}: ${failure.reason}`);
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
