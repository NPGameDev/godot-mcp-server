#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createBridge } from "./bridge.js";
import { lookupProject } from "./registry.js";
import { selectedProfile, resolveAllowedTools, isReadOnly, MUTATING_TOOLS, PROFILE_DISPLAY_NAMES } from "./profiles.js";
import {
  registerGroupSystem,
  registerAllGroupTools,
  registerGroupStubs,
  GROUP_TOOL_NAMES,
  resetLoadedGroups,
} from "./groups.js";
import { registerStubs } from "./stubs.js";
import { readMcpJsonEnv, applyEnvUpdate } from "./config_reload.js";
import { setToolRef, removeAllToolRefs, toolRefCount, hasToolRef } from "./tool_refs.js";
import { createHookPipeline } from "./hooks.js";
import { registerPrompts } from "./prompts.js";
import { registerResources } from "./resources.js";
import { init as initRoots, registerRoots } from "./roots.js";
import type { ToolTextResult } from "./types.js";
import { callAndWrap, toolError } from "./types.js";

import * as animation from "./tools/animation.js";
import * as asset from "./tools/asset.js";
import * as diff from "./tools/diff.js";
import * as editor from "./tools/editor.js";
import * as file from "./tools/file.js";
import * as folder from "./tools/folder.js";
import * as inputMap from "./tools/input_map.js";
import * as node from "./tools/node.js";
import * as playtest from "./tools/playtest.js";
import * as resource from "./tools/resource.js";
import * as runtime from "./tools/runtime.js";
import * as scene from "./tools/scene.js";
import * as script from "./tools/script.js";
import * as signal from "./tools/signals.js";
import * as save from "./tools/save.js";
import * as tilemap from "./tools/tilemap.js";
import * as classdb from "./tools/classdb.js";

// ── Tool catalogue ───────────────────────────────────────────────────

// All module tool-def arrays (gate-conditional arrays may be empty at
// import time when their env var is unset — that is correct: gated tools
// get stubs via registerStubs instead).
const ALL_MODULE_DEFS = [
  animation.animationTools,
  asset.assetTools,
  diff.diffTools,
  editor.editorTools,
  file.fileTools,
  folder.folderTools,
  inputMap.inputMapTools,
  node.nodeTools,
  playtest.playtestTools,
  resource.resourceTools,
  runtime.runtimeTools,
  scene.sceneTools,
  script.scriptTools,
  signal.signalTools,
  save.saveTools,
  tilemap.tilemapTools,
  classdb.classdbTools,
];

// ── Version gate ─────────────────────────────────────────────────────

// Tools that declare godotMinVersion are checked at call-time against the
// connected Godot version. Unknown (not-yet-connected) passes through.
const versionMap = new Map<string, number>();
for (const defs of ALL_MODULE_DEFS) {
  for (const t of defs) {
    if (t.godotMinVersion != null) versionMap.set(t.name, t.godotMinVersion);
  }
}

/**
 * Check whether the connected Godot version satisfies a tool's minimum.
 * Returns a toolError response if the check fails, or null to proceed.
 */
function checkVersionGate(toolName: string): ToolTextResult | null {
  const minVer = versionMap.get(toolName);
  if (minVer == null) return null;
  const connected = bridge.getGodotMinor();
  if (connected == null || connected >= minVer) return null;
  return toolError(
    "UNSUPPORTED",
    `${toolName} requires Godot 4.${minVer}+ (connected: 4.${connected})`,
    "Check COMPATIBILITY.md or use classdb.get_info for alternatives.",
  );
}

// ── Profile resolution ───────────────────────────────────────────────

let profile = selectedProfile();
let readOnly = isReadOnly();

/** Resolve profile → expanded allowed-tool set (never null). */
function buildAllowedTools(): Set<string> {
  let allowed = resolveAllowedTools(profile, readOnly);
  if (allowed === null) {
    allowed = new Set<string>();
    for (const defs of ALL_MODULE_DEFS) {
      for (const t of defs) allowed.add(t.name);
    }
    if (readOnly) {
      for (const name of MUTATING_TOOLS) allowed.delete(name);
    }
  }
  return allowed;
}

/** Subtract group-managed tools → set used by module register(). */
function buildModuleAllowed(allowed: Set<string>): Set<string> {
  const mod = new Set(allowed);
  for (const name of GROUP_TOOL_NAMES) mod.delete(name);
  return mod;
}

let allowedTools = buildAllowedTools();
let moduleAllowed = buildModuleAllowed(allowedTools);

// ── Bridge setup ─────────────────────────────────────────────────────

// Registry-based discovery. GODOT_MCP_PORT bypasses registry for
// backwards compat. Otherwise resolve via the system-wide projects.json.
const explicitPort = process.env.GODOT_MCP_PORT;
const explicitRuntimePort = process.env.GODOT_MCP_RUNTIME_PORT ?? null;
const projectPath = process.env.GODOT_MCP_PROJECT_PATH ?? process.cwd();

let editorPort: string;
if (explicitPort) {
  editorPort = explicitPort;
} else {
  const entry = lookupProject(projectPath);
  if (entry) {
    editorPort = String(entry.port);
    process.stderr.write(`[godot-mcp] registry: ${projectPath} → port ${editorPort}\n`);
  } else {
    editorPort = "6505";
    process.stderr.write(`[godot-mcp] registry: no entry for ${projectPath}; falling back to port ${editorPort}\n`);
  }
}

// ── Response caps ────────────────────────────────────────────────────

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

const scriptReadLimit = parseCapEnv("GODOT_MCP_SCRIPT_READ_LIMIT", SCRIPT_READ_LIMIT_DEFAULT, SCRIPT_READ_LIMIT_FLOOR);
const wsBufferLimit = parseCapEnv("GODOT_MCP_WS_BUFFER_LIMIT", WS_BUFFER_LIMIT_DEFAULT, WS_BUFFER_LIMIT_FLOOR);

const bridge = createBridge(`ws://127.0.0.1:${editorPort}`, {
  projectPath,
  explicitRuntimePort,
  explicitEditorPort: !!explicitPort,
  scriptReadLimitBytes: scriptReadLimit,
  wsBufferLimitBytes: wsBufferLimit,
});

// ── Server + hook pipeline ───────────────────────────────────────────

const server = new McpServer(
  { name: "godot-mcp-toolkit", version: "0.1.0" },
  {
    capabilities: { tools: { listChanged: true } },
    // Coalesce tools/list_changed notifications within the same event-loop
    // tick.  Without this, handleConfigReload fires one notification per
    // tool removal + one per tool registration (~77 total instead of 1).
    debouncedNotificationMethods: ["notifications/tools/list_changed"],
  },
);

const hookPipeline = createHookPipeline();

// Wrap server.registerTool to inject version gating and the hook
// pipeline around every tool handler, and capture the ref in the
// shared tool_refs registry (used by config reload + group stub swap).
const _origRegisterTool = server.registerTool.bind(server);
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- MCP SDK callback typing
(server as any).registerTool = (
  name: string,
  config: Parameters<typeof server.registerTool>[1],
  handler: (input: Record<string, unknown>) => Promise<ToolTextResult>,
) => {
  const ref = _origRegisterTool(name, config, async (input: Record<string, unknown>) => {
    const gateResult = checkVersionGate(name);
    if (gateResult) return gateResult;
    return hookPipeline.execute({ name, input: (input ?? {}) as Record<string, unknown> }, () => handler(input));
  });
  setToolRef(name, ref);
  return ref;
};

// ── Tool registration (shared by startup + reload) ──────────────────

function registerModules(ma: Set<string>): void {
  scene.register(server, bridge, ma);
  node.register(server, bridge, ma);
  script.register(server, bridge, ma);
  editor.register(server, bridge, ma);
  resource.register(server, bridge, ma);
  folder.register(server, bridge, ma);
  diff.register(server, bridge, ma);
  playtest.register(server, bridge, ma);
  tilemap.register(server, bridge, ma);
  asset.register(server, bridge, ma);
  runtime.register(server, bridge, ma);
  signal.register(server, bridge, ma);
  animation.register(server, bridge, ma);
  inputMap.register(server, bridge, ma);
  file.register(server, bridge, ma);
  save.register(server, bridge, ma);
  classdb.register(server, bridge, ma);
}

function registerGroups(): void {
  if (profile === "power_user") {
    registerAllGroupTools(server, bridge, readOnly);
  } else if (profile !== "minimal") {
    registerGroupSystem(server, bridge, readOnly);
  }
  registerStubs(server, profile);
  registerGroupStubs(server, profile, readOnly);
  // Fill remaining tools with LOCKED stubs so the deferred-tools
  // catalogue is complete at startup regardless of profile/gate/group.
  registerCatalogueStubs();
}

/**
 * Extract a one-liner from a tool description (up to first period).
 * Used for auto-generating LOCKED stub descriptions from module defs.
 */
function firstSentence(desc: string): string {
  const dot = desc.indexOf(".");
  if (dot > 0 && dot < 120) return desc.substring(0, dot);
  return desc.substring(0, 80).trimEnd();
}

/** Shared handler for profile-locked stubs. */
function profileLockedHandler() {
  return async () => ({
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          success: false,
          error: `Not available in ${PROFILE_DISPLAY_NAMES[profile]} profile.`,
          code: "PROFILE_LOCKED",
          hint: "Change profile via GODOT_MCP_PROFILE in .mcp.json env or the Godot editor dock.",
        }),
      },
    ],
    isError: true,
  });
}

/**
 * Fill remaining unregistered tools with LOCKED stubs.
 * - Minimal: stubs for all standard/power_user module tools
 * - All profiles: enable_tool_group stub if not already real
 */
function registerCatalogueStubs(): void {
  // Module-tool stubs for minimal profile
  if (profile === "minimal") {
    for (const defs of ALL_MODULE_DEFS) {
      for (const tool of defs) {
        if (hasToolRef(tool.name)) continue;
        if (GROUP_TOOL_NAMES.has(tool.name)) continue;
        server.registerTool(
          tool.name,
          {
            description: `LOCKED — ${firstSentence(tool.description)}. Standard/Power User profile.`,
            annotations: { openWorldHint: false },
          },
          profileLockedHandler(),
        );
      }
    }
  }

  // enable_tool_group stub for profiles that don't register the real meta-tool
  if (!hasToolRef("enable_tool_group")) {
    server.registerTool(
      "enable_tool_group",
      {
        description: "LOCKED — load tool groups on demand. Standard profile.",
        annotations: { openWorldHint: false },
      },
      profileLockedHandler(),
    );
  }
}

function logProfile(): void {
  process.stderr.write(
    `[godot-mcp] profile=${profile} (${PROFILE_DISPLAY_NAMES[profile]}) readOnly=${readOnly} tools=${moduleAllowed.size}+groups hooks=${hookPipeline.length} caps=${scriptReadLimit / 1024}KB/${wsBufferLimit / 1024}KB\n`,
  );
  if (profile === "power_user") {
    process.stderr.write(
      "[godot-mcp] WARNING: Power User profile active — all tools including unsafe operations are enabled.\n" +
        "[godot-mcp] This includes tools that can modify project settings, execute code, and write outside res://.\n",
    );
  }
}

// ── Initial registration ────────────────────────────────────────────

registerModules(moduleAllowed);
registerGroups();

// ── Prompts, resources, roots ────────────────────────────────────────

registerPrompts(server);
registerResources(server, bridge);
initRoots(projectPath);
registerRoots(server);

logProfile();

// ── Live config reload ──────────────────────────────────────────────

function removeAllTools(): void {
  removeAllToolRefs();
  resetLoadedGroups();
}

function handleConfigReload(params?: Record<string, unknown>, notify = true): void {
  const pluginProfile = params?.profile as string | undefined;
  const pluginGates = params?.gates as Record<string, boolean> | undefined;

  if (pluginGates) {
    // Gates delivered directly from plugin auth/notification — apply to
    // process.env without re-reading .mcp.json (which may be stale).
    applyGateState(pluginGates, pluginProfile);
  } else {
    // Fallback: re-read .mcp.json (old plugin version or manual edit).
    const newEnv = readMcpJsonEnv(projectPath);
    if (!newEnv) {
      process.stderr.write("[godot-mcp] config_reloaded: could not read .mcp.json env — skipping reload\n");
      return;
    }
    applyEnvUpdate(newEnv);
  }

  const oldProfile = profile;
  profile = selectedProfile();
  readOnly = isReadOnly();
  allowedTools = buildAllowedTools();
  moduleAllowed = buildModuleAllowed(allowedTools);

  removeAllTools();
  registerModules(moduleAllowed);
  registerGroups();

  if (pluginGates) {
    process.stderr.write(`[godot-mcp] gate states from plugin: ${JSON.stringify(pluginGates)}\n`);
  }

  process.stderr.write(
    `[godot-mcp] config reloaded: ${oldProfile} → ${profile}` +
      (pluginProfile ? ` (plugin reports: ${pluginProfile})` : "") +
      ` — ${toolRefCount()} tools registered\n`,
  );
  if (profile === "power_user") {
    process.stderr.write(
      "[godot-mcp] WARNING: Power User profile active — all tools including unsafe operations are enabled.\n",
    );
  }

  if (notify) {
    process.stderr.write("[godot-mcp] sending notifications/tools/list_changed\n");
    server.sendToolListChanged();
  } else {
    process.stderr.write("[godot-mcp] initial auth sync — skipping tools/list_changed to avoid connection bounce\n");
  }

  // Re-discover user commands (async, non-blocking).
  discoverUserCommands().catch(() => {});
}

/**
 * Apply gate state delivered by the plugin (auth response or notification).
 * Maps boolean gates to process.env GODOT_MCP_* vars so the existing
 * isEnabled() / selectedProfile() machinery works unchanged.
 */
function applyGateState(gates: Record<string, boolean>, pluginProfile?: string): void {
  for (const [envVar, enabled] of Object.entries(gates)) {
    if (enabled) {
      process.env[envVar] = "1";
    } else {
      delete process.env[envVar];
    }
  }
  if (pluginProfile) {
    process.env.GODOT_MCP_PROFILE = pluginProfile;
  }
}

// Debounce config_reloaded to prevent rapid gate toggles from causing
// overlapping remove+rebuild cycles that leave the tool list empty.
let configReloadTimer: ReturnType<typeof setTimeout> | null = null;
// The first auth-delivered config_reloaded (reconnect=false) is the initial
// gate sync.  Suppress tools/list_changed for it — Claude Code may restart
// the MCP server when it receives the notification within the first second.
let initialAuthSyncDone = false;

bridge.onNotification((type, params) => {
  if (type === "config_reloaded") {
    // Auth-sourced notifications include `reconnect`; plugin-sent ones don't.
    const isInitialAuth = !initialAuthSyncDone && params?.reconnect === false;
    if (params?.reconnect !== undefined) initialAuthSyncDone = true;

    if (isInitialAuth) {
      // On the very first auth of a new bridge process, tools were JUST
      // registered at startup from the same env vars.  A full
      // handleConfigReload would call registerTool() for every tool, and
      // the MCP SDK's internal debounced tools/list_changed notification
      // (which we cannot suppress) would reach Claude Code within the
      // first second — causing it to kill and restart the bridge.
      // Instead, just sync env vars so subsequent operations see the
      // plugin's gate state, and skip tool re-registration entirely.
      const pluginGates = params?.gates as Record<string, boolean> | undefined;
      const pluginProfile = params?.profile as string | undefined;
      if (pluginGates) applyGateState(pluginGates, pluginProfile);
      process.stderr.write(
        "[godot-mcp] initial auth sync — env applied, skipping tool reload to avoid connection bounce\n",
      );
      return;
    }

    if (configReloadTimer) clearTimeout(configReloadTimer);
    configReloadTimer = setTimeout(() => {
      configReloadTimer = null;
      handleConfigReload(params);
    }, 300);
  }
});

// ── User command discovery ───────────────────────────────────────────

// After the server starts, discover user-defined commands from the toolkit
// and register them as MCP tools. Non-blocking: if the editor is unreachable,
// built-in tools still work and user commands will be missing.
async function discoverUserCommands(): Promise<void> {
  try {
    const result = (await bridge.call("meta.user_commands", {}, 5000)) as {
      success?: boolean;
      commands?: { method: string }[];
    };
    if (!result?.success || !Array.isArray(result.commands)) return;
    let registered = 0;
    for (const cmd of result.commands) {
      const toolName = cmd.method.replace(/\./g, "_");
      server.registerTool(
        toolName,
        {
          description: `User command: ${cmd.method}`,
          inputSchema: {},
          annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            openWorldHint: false,
          },
        },
        (input: unknown) => callAndWrap(bridge, cmd.method, input),
      );
      registered++;
    }
    if (registered > 0) {
      process.stderr.write(`[godot-mcp] registered ${registered} user command(s)\n`);
      server.sendToolListChanged();
    }
  } catch {
    // Editor unreachable or meta.user_commands not available — not an error.
  }
}

// ── Lifecycle ────────────────────────────────────────────────────────

async function shutdown(): Promise<void> {
  try {
    await bridge.close();
  } finally {
    process.exit(0);
  }
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

const transport = new StdioServerTransport();
await server.connect(transport);

discoverUserCommands().catch(() => {
  // Swallowed — discoverUserCommands already handles errors internally.
  // This catch prevents Node's unhandledRejection for edge-case async throws.
});
