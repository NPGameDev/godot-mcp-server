// ── Startup environment preflight ────────────────────────────────────
//
// One-shot boot-environment resolution + validation for the composition
// root (index.ts). Each function here is a stateless preflight: it reads
// process.env / the static catalogue, emits stderr (or stdout) diagnostics,
// and — for the exit gates — may process.exit. No subsystem state lives
// here; the root calls these in sequence before constructing the bridge.
// Port resolution lives in its own collaborator (portConfig.ts).

import { ALL_TOOL_DEFS, META_TOOL_NAMES } from "../registration/catalogue.js";
import { countBuiltinOperations } from "../registration/operations.js";
import { GROUP_TOOL_NAMES, GROUPS } from "../groups/groups.js";
import { MODULE_ALLOWED } from "./serverMode.js";
import type { CliArgs } from "./cliArgs.js";
import { formatHelp } from "./cliArgs.js";

/** Hard-exit (code 1) if the Node runtime is below the engines.node floor (>=22). */
export function enforceNodeVersion(): void {
  const [nodeMajor] = process.versions.node.split(".").map(Number);
  if (nodeMajor < 22) {
    process.stderr.write(
      `[godot-mcp] Error: requires Node.js >= 22 (found ${process.version}).\n` +
        `Download the latest LTS from https://nodejs.org\n`,
    );
    process.exit(1);
  }
}

/** The static built-in tool manifest by name: the eagerly-registered set, the
 *  always-on meta tools, and each on-demand group's tools. Excludes dynamic
 *  extension tools. */
export interface EagerManifest {
  /** Names registered eagerly at startup (always in the initial tools/list). */
  eager: readonly string[];
  /** Always-on meta tool names (discover_tools, extensions_refresh). */
  meta: readonly string[];
  /** Group name → the tools that group activates on demand. */
  groups: Record<string, readonly string[]>;
}

/**
 * Build the static built-in tool manifest by name, deterministically sorted.
 *
 * The eager set is derived from `MODULE_ALLOWED` — the same set index.ts hands to
 * `registerBuiltinModules` — so the manifest reflects the names registered
 * eagerly rather than a parallel list. Meta names come from `META_TOOL_NAMES` and
 * group membership from `GROUPS`, the same sources `--tools-count` counts.
 *
 * @returns the manifest; every array and every `groups` key ascending-sorted so
 *   the serialization is byte-stable across turns
 * @remarks Names only, and only the static built-in surface — per-project
 *   extension tools are dynamic and excluded, matching `--tools-count`.
 */
export function buildEagerManifest(): EagerManifest {
  const eager = [...MODULE_ALLOWED].sort();
  const meta = [...META_TOOL_NAMES].sort();
  const groups: Record<string, string[]> = {};
  for (const group of [...GROUPS].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    groups[group.name] = [...group.tools].sort();
  }
  return { eager, meta, groups };
}

/** Print the eager+meta tool manifest as pretty JSON to stdout — a pre-transport
 *  CLI report. Names only; a clean early-exit emit before any MCP wiring. */
function printEagerList(): void {
  process.stdout.write(JSON.stringify(buildEagerManifest(), null, 2) + "\n");
}

/** Print the static tool-count summary to stdout — a pre-transport CLI report,
 *  derived from the canonical ALL_TOOL_DEFS (excludes dynamic extension tools). */
function printToolCount(): void {
  const total = ALL_TOOL_DEFS.length;
  const onDemand = GROUP_TOOL_NAMES.size;
  const eager = total - onDemand;
  process.stdout.write(
    `Total tools:  ${total}\n` +
      `  Eager:      ${eager}\n` +
      `  On-demand:  ${onDemand}\n` +
      `Meta:         ${META_TOOL_NAMES.length} (also eager — always in tools/list)\n` +
      `Groups:       ${GROUPS.length}\n` +
      `Operations (built-in): ${countBuiltinOperations(ALL_TOOL_DEFS)}\n` +
      `Startup surface (eager + meta): ${eager + META_TOOL_NAMES.length}\n`,
  );
}

/**
 * Apply the CLI meta gates that print-and-exit before any bridge/WebSocket/
 * transport setup (all editor-independent):
 *   - `--help` → usage on **stdout**, exit 0 (a CLI invocation, not an MCP session)
 *   - a parse error → the message + usage on **stderr**, exit 1 (fail loud)
 *   - `--tools-count` → the static count on **stdout**, exit 0
 *   - `--list-eager` → the static tool manifest as JSON on **stdout**, exit 0
 *
 * No-op when argv carries none of these. `--help` wins over a parse error so a
 * bad flag alongside `--help` still prints usage rather than erroring.
 */
export function applyCliMetaGates(cli: CliArgs): void {
  if (cli.help) {
    process.stdout.write(formatHelp());
    process.exit(0);
  }
  if (cli.error) {
    process.stderr.write(`[godot-mcp] ${cli.error}\n\n${formatHelp()}`);
    process.exit(1);
  }
  if (cli.toolsCount) {
    printToolCount();
    process.exit(0);
  }
  if (cli.listEager) {
    printEagerList();
    process.exit(0);
  }
}

// ── Response caps ────────────────────────────────────────────────────

export type ResponseCaps = { scriptReadLimitBytes: number; wsBufferLimitBytes: number };

// Defaults match the plugin-side ProjectSettings defaults.
const SCRIPT_READ_LIMIT_DEFAULT = 262144; // 256 KB
const WS_BUFFER_LIMIT_DEFAULT = 1048576; // 1 MB
const SCRIPT_READ_LIMIT_FLOOR = 65536; // 64 KB
const WS_BUFFER_LIMIT_FLOOR = 262144; // 256 KB

function parseCapEnv(envName: string, defaultVal: number, floor: number): number {
  const raw = process.env[envName];
  if (!raw) return defaultVal;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    process.stderr.write(
      `[godot-mcp] WARNING: ${envName}=${raw} is not a valid positive number; using default ${defaultVal}\n`,
    );
    return defaultVal;
  }
  if (parsed < floor) {
    process.stderr.write(`[godot-mcp] WARNING: ${envName}=${parsed} is below minimum ${floor}; clamping to ${floor}\n`);
    return floor;
  }
  return parsed;
}

/** Parse + clamp GODOT_MCP_SCRIPT_READ_LIMIT / _WS_BUFFER_LIMIT against their floors/defaults. */
export function resolveResponseCaps(): ResponseCaps {
  const scriptReadLimitBytes = parseCapEnv(
    "GODOT_MCP_SCRIPT_READ_LIMIT",
    SCRIPT_READ_LIMIT_DEFAULT,
    SCRIPT_READ_LIMIT_FLOOR,
  );
  const wsBufferLimitBytes = parseCapEnv("GODOT_MCP_WS_BUFFER_LIMIT", WS_BUFFER_LIMIT_DEFAULT, WS_BUFFER_LIMIT_FLOOR);
  return { scriptReadLimitBytes, wsBufferLimitBytes };
}

// ── Config version check ─────────────────────────────────────────────

const EXPECTED_CONFIG_VERSION = 1;

/** Warn (stderr) if GODOT_MCP_CONFIG_VERSION is missing / non-numeric / older / newer than EXPECTED. */
export function warnConfigVersion(): void {
  const rawConfigVersion = process.env.GODOT_MCP_CONFIG_VERSION;
  if (rawConfigVersion == null || rawConfigVersion === "") {
    process.stderr.write(
      "[godot-mcp] WARNING: no GODOT_MCP_CONFIG_VERSION in env. " +
        "Config may be from a pre-release build — regenerate .mcp.json from the toolkit dock.\n",
    );
  } else {
    const configVersion = Number(rawConfigVersion);
    if (!Number.isFinite(configVersion)) {
      process.stderr.write(
        `[godot-mcp] WARNING: GODOT_MCP_CONFIG_VERSION="${rawConfigVersion}" is not a valid number.\n`,
      );
    } else if (configVersion < EXPECTED_CONFIG_VERSION) {
      process.stderr.write(
        `[godot-mcp] WARNING: config version ${configVersion} is outdated (expected ${EXPECTED_CONFIG_VERSION}). ` +
          `Regenerate .mcp.json from the toolkit dock.\n`,
      );
    } else if (configVersion > EXPECTED_CONFIG_VERSION) {
      process.stderr.write(
        `[godot-mcp] WARNING: config version ${configVersion} is newer than this server understands (max ${EXPECTED_CONFIG_VERSION}). ` +
          `Consider updating the server (npm update).\n`,
      );
    }
  }
}
