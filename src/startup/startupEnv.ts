// ── Startup environment preflight ────────────────────────────────────
//
// One-shot boot-environment resolution + validation for the composition
// root (index.ts). Each function here is a stateless preflight: it reads
// process.env / the static catalogue, emits stderr (or stdout) diagnostics,
// and — for the exit gates — may process.exit. No subsystem state lives
// here; the root calls these in sequence before constructing the bridge.
// Port resolution lives in its own collaborator (portConfig.ts).

import { ALL_TOOL_DEFS, META_TOOL_NAMES } from "../registration/catalogue.js";
import { GROUP_TOOL_NAMES, GROUPS } from "../groups/groups.js";
import type { CliArgs } from "./cliArgs.js";
import { formatHelp } from "./cliArgs.js";

/** Hard-exit (code 1) if the Node runtime is below the engines.node floor (>=20). */
export function enforceNodeVersion(): void {
  const [nodeMajor] = process.versions.node.split(".").map(Number);
  if (nodeMajor < 20) {
    process.stderr.write(
      `[godot-mcp] Error: requires Node.js >= 20 (found ${process.version}).\n` +
        `Download the latest LTS from https://nodejs.org\n`,
    );
    process.exit(1);
  }
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
      `Startup surface (eager + meta): ${eager + META_TOOL_NAMES.length}\n`,
  );
}

/**
 * Apply the CLI meta gates that print-and-exit before any bridge/WebSocket/
 * transport setup (all editor-independent):
 *   - `--help` → usage on **stdout**, exit 0 (a CLI invocation, not an MCP session)
 *   - a parse error → the message + usage on **stderr**, exit 1 (fail loud)
 *   - `--tools-count` → the static count on **stdout**, exit 0
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
