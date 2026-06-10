// ═══════════════════════════════════════════════════════════════════════════
// Shared suite orchestrator — extracted from smoke.ts (41m-bis) so the flow
// suite (test/flows.ts) can reuse the same scaffolding:
//   • CLI flag parsing (--from / --to / --only / --skip)
//   • pass/fail counters + summary + exit codes (0 pass / 1 fail / 2 precond)
//   • project-path discovery (registry lookup for the per-worktree token)
//   • port probe → bridge/ctx build → section loop → bridge close
//
// Both `npm run smoke` and `npm run flows` call runFullSuite() with their own
// section list. Smoke keeps its CI-mode branch in smoke.ts (static catalogue
// validation, no Godot); the flow suite has no CI mode — it is editor-required
// and local-only (decision #8: no hollow flows:ci).
//
// This module is deliberately behaviour-preserving for smoke: with
// label="smoke", interSectionDelayMs=150 (pre-strip), and reorderLast=19, the
// console output and exit semantics are identical to the pre-extraction
// orchestrator.
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync } from "node:fs";

import { createBridge } from "../src/bridge.js";
import { registryPath } from "../src/registry.js";

import { HOST, PORT, RUNTIME_PORT, PROBE_TIMEOUT_MS, probePort, printUnreachable } from "./helpers.js";
import type { TestCtx } from "./helpers.js";

// ─── Section registry shape ───────────────────────────────────────────────

export interface Section {
  num: number;
  name: string;
  run: (ctx: TestCtx) => Promise<void> | void;
}

// ─── Counters ──────────────────────────────────────────────────────────────
// One Counters instance per suite run. The label drives the `[label] PASS/FAIL`
// line prefix and the summary header, so smoke output stays byte-identical.

export interface Counters {
  pass: (msg: string) => void;
  fail: (msg: string) => void;
  printSummary: () => void;
  failCount: () => number;
  passCount: () => number;
}

function capitalize(s: string): string {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s;
}

export function makeCounters(label: string): Counters {
  let passCount = 0;
  let failCount = 0;
  return {
    pass(msg: string): void {
      passCount++;
      console.log(`[${label}] PASS  ${msg}`);
    },
    fail(msg: string): void {
      failCount++;
      console.error(`[${label}] FAIL  ${msg}`);
    },
    printSummary(): void {
      const total = passCount + failCount;
      const bar = "-".repeat(50);
      console.log(`\n${bar}`);
      console.log(`${capitalize(label)}: ${passCount} passed, ${failCount} failed, ${total} total`);
      console.log(bar);
    },
    failCount: () => failCount,
    passCount: () => passCount,
  };
}

// ─── CLI flag parsing ──────────────────────────────────────────────────────

export interface FilterFlags {
  from?: number;
  to?: number;
  only?: number[];
  skip?: number[];
}

function parseIntArg(argv: string[], flag: string): number | undefined {
  const idx = argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= argv.length) return undefined;
  const val = parseInt(argv[idx + 1], 10);
  return isNaN(val) ? undefined : val;
}

function parseListArg(argv: string[], flag: string): number[] | undefined {
  const idx = argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= argv.length) return undefined;
  return argv[idx + 1]
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n));
}

export function parseFilterFlags(argv: string[] = process.argv): FilterFlags {
  return {
    from: parseIntArg(argv, "--from"),
    to: parseIntArg(argv, "--to"),
    only: parseListArg(argv, "--only"),
    skip: parseListArg(argv, "--skip"),
  };
}

// ─── Project-path discovery ────────────────────────────────────────────────
// Discover the project path for the editor listening on PORT so the bridge can
// derive the per-worktree token filename. Prefers env var, then searches the
// registry for a matching port entry. When multiple entries share the same
// port (stale leftover from a dead editor), prefer the one with the highest
// started_at timestamp and filter out dead PIDs.

export function discoverProjectPath(): string | undefined {
  const envPath = process.env.GODOT_MCP_PROJECT_PATH;
  if (envPath) return envPath;
  try {
    const data = JSON.parse(readFileSync(registryPath(), "utf-8")) as {
      by_path?: Record<string, { port?: number; started_at?: number; pid?: number }>;
    };
    let best: { path: string; startedAt: number } | undefined;
    for (const [path, entry] of Object.entries(data.by_path ?? {})) {
      if (entry.port !== PORT) continue;
      // Filter out entries whose PID is provably dead.
      if (entry.pid != null && entry.pid > 0) {
        try {
          process.kill(entry.pid, 0);
        } catch {
          continue; // PID dead — skip stale entry.
        }
      }
      const ts = entry.started_at ?? 0;
      if (!best || ts > best.startedAt) {
        best = { path, startedAt: ts };
      }
    }
    return best?.path;
  } catch {
    // Registry unreadable — fall through.
  }
  return undefined;
}

// ─── Section filtering ─────────────────────────────────────────────────────

export interface FilterOpts {
  label: string;
  /** Section number forced to run last when present (smoke: 19 reconnect). */
  reorderLast?: number;
}

export function filterSections(all: Section[], flags: FilterFlags, opts: FilterOpts): Section[] {
  const { label, reorderLast } = opts;
  let filtered: Section[];

  if (flags.only) {
    const set = new Set(flags.only);
    filtered = all.filter((s) => set.has(s.num));
    if (flags.skip) {
      console.log(`[${label}] WARNING: --skip ignored when --only is set\n`);
    }
  } else if (flags.from !== undefined || flags.to !== undefined) {
    const from = flags.from ?? 1;
    const to = flags.to ?? Infinity;
    filtered = all.filter((s) => s.num >= from && s.num <= to);
  } else {
    filtered = [...all];
  }

  // --skip post-filter
  if (flags.skip && !flags.only) {
    const skipSet = new Set(flags.skip);
    const skippedNums: number[] = [];
    filtered = filtered.filter((s) => {
      if (skipSet.has(s.num)) {
        skippedNums.push(s.num);
        return false;
      }
      return true;
    });
    if (skippedNums.length > 0) {
      console.log(`[${label}] --skip: excluded sections ${skippedNums.join(", ")}`);
    }
  }

  // Optionally force one section to run last (smoke's reconnect drops the
  // connection, so it must come after every other section).
  if (reorderLast !== undefined) {
    const idx = filtered.findIndex((s) => s.num === reorderLast);
    if (idx !== -1 && idx !== filtered.length - 1) {
      const [moved] = filtered.splice(idx, 1);
      filtered.push(moved);
    }
  }

  return filtered;
}

// ─── Full-suite runner ─────────────────────────────────────────────────────
// Port probe → bridge + ctx build → filtered section loop → summary → exit.
// Always terminates the process (exit 2 on unreachable editor, 1 on failures,
// 0 on all-pass) — the caller does not return from this.

export interface SuiteConfig {
  label: string;
  counters: Counters;
  sections: Section[];
  flags: FilterFlags;
  /** Inter-section pause (ms). Omit/0 = run at full speed. */
  interSectionDelayMs?: number;
  /** Section number forced to run last (smoke: 19 reconnect). */
  reorderLast?: number;
}

export async function runFullSuite(config: SuiteConfig): Promise<void> {
  const { label, counters, sections: allSections, flags } = config;

  const reachable = await probePort(HOST, PORT, PROBE_TIMEOUT_MS);
  if (!reachable) {
    printUnreachable(label);
    process.exit(2);
  }

  const projectPath = discoverProjectPath();
  const bridge = createBridge(`ws://${HOST}:${PORT}`, {
    projectPath,
    explicitRuntimePort: String(RUNTIME_PORT),
  });
  const ctx: TestCtx = {
    bridge,
    fail: counters.fail,
    pass: counters.pass,
    projectPath,
  };

  const sections = filterSections(allSections, flags, { label, reorderLast: config.reorderLast });
  const nums = sections.map((s) => s.num);
  if (flags.only || flags.from !== undefined || flags.to !== undefined || flags.skip) {
    console.log(`[${label}] Running sections: ${nums.join(", ")}\n`);
  }

  try {
    for (let i = 0; i < sections.length; i++) {
      // Optional pace between sections so the editor can drain deferred calls.
      // Smoke historically used 150ms (smoke.ts); the flow suite runs full
      // speed. See 41m-bis decision #6 (evidence-gated strip).
      if (i > 0 && config.interSectionDelayMs) {
        await new Promise((r) => setTimeout(r, config.interSectionDelayMs));
      }
      await sections[i].run(ctx);
    }
  } catch (err) {
    counters.fail(`unexpected error: ${(err as Error).message}`);
  } finally {
    await bridge.close();
  }

  counters.printSummary();
  process.exit(counters.failCount() > 0 ? 1 : 0);
}
