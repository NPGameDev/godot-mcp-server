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

/** The response caps the environment sets, in bytes. An undefined cap is not
 *  configured: the editor's own `mcp_toolkit/limits/*` project setting governs it. */
export interface ResponseCaps {
  /** From `GODOT_MCP_SCRIPT_READ_LIMIT`: the cap on script-read responses. */
  scriptReadLimitBytes?: number;
  /** From `GODOT_MCP_WS_BUFFER_LIMIT`: the editor's per-connection WebSocket buffer size. */
  wsBufferLimitBytes?: number;
}

// Floors match the minimums the plugin clamps meta.set_limits values to.
const SCRIPT_READ_LIMIT_FLOOR = 65536; // 64 KB
const WS_BUFFER_LIMIT_FLOOR = 262144; // 256 KB

/** Read one cap from the environment. Unset or empty yields undefined. An invalid
 *  value is ignored with a warning instead of becoming a default, since a pushed
 *  default would override the project's own setting. A value below the floor is
 *  still a configured cap, so it is clamped up to the floor. */
function parseCapEnv(envName: string, floor: number): number | undefined {
  const raw = process.env[envName];
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    process.stderr.write(
      `[godot-mcp] WARNING: ${envName}=${raw} is not a valid positive number; ignoring it, so the project's own setting applies\n`,
    );
    return undefined;
  }
  if (parsed < floor) {
    process.stderr.write(`[godot-mcp] WARNING: ${envName}=${parsed} is below minimum ${floor}; clamping to ${floor}\n`);
    return floor;
  }
  return parsed;
}

/**
 * Resolve the response caps from `GODOT_MCP_SCRIPT_READ_LIMIT` and
 * `GODOT_MCP_WS_BUFFER_LIMIT`, both in bytes. A variable that is unset, empty or
 * invalid leaves its cap undefined; a value below the floor is clamped to it.
 */
export function resolveResponseCaps(): ResponseCaps {
  return {
    scriptReadLimitBytes: parseCapEnv("GODOT_MCP_SCRIPT_READ_LIMIT", SCRIPT_READ_LIMIT_FLOOR),
    wsBufferLimitBytes: parseCapEnv("GODOT_MCP_WS_BUFFER_LIMIT", WS_BUFFER_LIMIT_FLOOR),
  };
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
