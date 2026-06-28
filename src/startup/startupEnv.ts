// ── Startup environment preflight ────────────────────────────────────
//
// One-shot boot-environment resolution + validation for the composition
// root (index.ts). Each function here is a stateless preflight: it reads
// process.env / argv / the static catalogue, emits stderr (or stdout)
// diagnostics, and — for the two gates — may process.exit. No subsystem
// state lives here; the root calls these in sequence before constructing
// the bridge. Extracted from index.ts (concern 062, commit C0).

import { ALL_TOOL_DEFS, META_TOOL_NAMES } from "../registration/catalogue.js";
import { GROUP_TOOL_NAMES, GROUPS } from "../groups/groups.js";
import { lookupProject } from "../registry.js";

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

/**
 * If argv has --tools-count, print the static tool-count summary and
 * process.exit(0). No-op otherwise. Must run before any bridge/WebSocket/
 * transport setup so it is editor-independent.
 *
 * Static count of the tools the server ships, derived from the canonical
 * ALL_TOOL_DEFS. Excludes per-project extension tools (dynamic).
 */
export function maybePrintToolCountAndExit(): void {
  if (process.argv.includes("--tools-count")) {
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
    process.exit(0);
  }
}

/**
 * Resolve the editor WebSocket port: GODOT_MCP_PORT bypass → registry lookup
 * → "6550" fallback. Emits the chosen-port stderr line.
 */
export function resolveEditorPort(projectPath: string): string {
  // Registry-based discovery. GODOT_MCP_PORT bypasses registry for
  // backwards compat. Otherwise resolve via the system-wide projects.json.
  const explicitPort = process.env.GODOT_MCP_PORT;
  let editorPort: string;
  if (explicitPort) {
    editorPort = explicitPort;
  } else {
    const entry = lookupProject(projectPath);
    if (entry) {
      editorPort = String(entry.port);
      process.stderr.write(`[godot-mcp] registry: ${projectPath} → port ${editorPort}\n`);
    } else {
      editorPort = "6550";
      process.stderr.write(`[godot-mcp] registry: no entry for ${projectPath}; falling back to port ${editorPort}\n`);
    }
  }
  return editorPort;
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
