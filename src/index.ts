#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createBridge } from "./bridge.js";
import { lookupProject } from "./registry.js";
import { resolveAllowedTools, isReadOnly, warnDeprecatedEnvVars } from "./profiles.js";
import {
  registerGroupSystem,
  GROUP_TOOL_NAMES,
  resetLoadedGroups,
  addExtensionGroup,
  removeExtensionCommand,
  removeUngroupedExtensionTool,
} from "./groups.js";
import type { ExtensionCmd } from "./groups.js";
// feature_gate.ts provides isEnabled/envVarFor — used by groups.ts and tool_helpers.ts.
// No direct import needed here after profile removal.
import { readMcpJsonEnv, applyEnvUpdate } from "./config_reload.js";
import { removeAllToolRefs, toolRefCount, hasToolRef } from "./tool_refs.js";
import { createHookPipeline } from "./hooks.js";
import { registerPrompts } from "./prompts.js";
import { registerResources } from "./resources.js";
import { init as initRoots, registerRoots } from "./roots.js";
import type { ToolTextResult } from "./types.js";
import { callAndWrap, registerToolWrapped, batchToolRegistration, setGlobalHookPipeline } from "./tool_helpers.js";

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
import * as nodeManagement from "./tools/node_management.js";
import * as sceneQuery from "./tools/scene_query.js";

// ── Node.js version gate ────────────────────────────────────────────
const [nodeMajor] = process.versions.node.split(".").map(Number);
if (nodeMajor < 20) {
  process.stderr.write(
    `[godot-mcp] Error: requires Node.js >= 20 (found ${process.version}).\n` +
      `Download the latest LTS from https://nodejs.org\n`,
  );
  process.exit(1);
}

// ── Mode resolution ─────────────────────────────────────────────────

warnDeprecatedEnvVars();
let readOnly = isReadOnly();

function buildAllowedTools(): Set<string> {
  return resolveAllowedTools(readOnly);
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
  },
);

const hookPipeline = createHookPipeline();
setGlobalHookPipeline(hookPipeline);

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
  nodeManagement.register(server, bridge, ma);
  sceneQuery.register(server, bridge, ma);
}

function registerGroups(): void {
  // Register discover_tools with built-in groups BEFORE transport
  // connects, so it's in the initial tools/list response — no extra
  // notification needed for the common case (no extensions).
  // If extensions are later discovered, registerGroupSystem is called
  // again (idempotent) which updates the description.
  registerGroupSystem(server, bridge, readOnly);
}

function logStartup(): void {
  process.stderr.write(
    `[godot-mcp] readOnly=${readOnly} tools=${toolRefCount()} hooks=${hookPipeline.length} caps=${scriptReadLimit / 1024}KB/${wsBufferLimit / 1024}KB\n`,
  );
}

// ── Initial registration ────────────────────────────────────────────

registerModules(moduleAllowed);
registerGroups();

// ── Prompts, resources, roots ────────────────────────────────────────

registerPrompts(server);
registerResources(server, bridge);
initRoots(projectPath);
registerRoots(server);

logStartup();

// ── Live config reload ──────────────────────────────────────────────

function removeAllTools(): void {
  removeAllToolRefs();
  resetLoadedGroups();
}

function handleConfigReload(params?: Record<string, unknown>): void {
  const pluginGates = params?.gates as Record<string, boolean> | undefined;

  if (pluginGates) {
    // Gates delivered directly from plugin auth/notification — apply to
    // process.env without re-reading .mcp.json (which may be stale).
    applyGateState(pluginGates);
  } else {
    // Fallback: re-read .mcp.json (old plugin version or manual edit).
    const newEnv = readMcpJsonEnv(projectPath);
    if (!newEnv) {
      process.stderr.write("[godot-mcp] config_reloaded: could not read .mcp.json env — skipping reload\n");
      return;
    }
    applyEnvUpdate(newEnv);
  }

  readOnly = isReadOnly();
  allowedTools = buildAllowedTools();
  moduleAllowed = buildModuleAllowed(allowedTools);

  removeAllTools();
  registerModules(moduleAllowed);
  registerGroups();

  if (pluginGates) {
    process.stderr.write(`[godot-mcp] gate states from plugin: ${JSON.stringify(pluginGates)}\n`);
  }

  process.stderr.write(`[godot-mcp] config reloaded — ${toolRefCount()} tools registered\n`);

  // Re-discover extensions + register discover_tools (the MCP SDK
  // auto-emits tool list notifications on each registerTool call).
  discoverExtensions().catch(() => {});
}

/**
 * Apply gate state delivered by the plugin (auth response or notification).
 * Maps boolean gates to process.env GODOT_MCP_* vars so isEnabled() works.
 */
function applyGateState(gates: Record<string, boolean>): void {
  for (const [envVar, enabled] of Object.entries(gates)) {
    if (enabled) {
      process.env[envVar] = "1";
    } else {
      delete process.env[envVar];
    }
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
      // the tools/list_changed notification would reach Claude Code within the
      // first second — causing it to kill and restart the bridge.
      // Instead, just sync env vars so subsequent operations see the
      // plugin's gate state, and skip tool re-registration entirely.
      const pluginGates = params?.gates as Record<string, boolean> | undefined;
      if (pluginGates) applyGateState(pluginGates);
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
  } else if (type === "extensions.changed") {
    handleExtensionsChanged(params);
  } else if (type === "game_stopped") {
    // Proactive runtime teardown: editor detected game-stop/crash and
    // notified us. Clear the runtime channel immediately so the next
    // callRuntime() fails with GAME_NOT_RUNNING in 0ms (no TCP probe).
    bridge.clearRuntime?.();
  }
});

// ── Extension discovery ──────────────────────────────────────────────

const DEFAULT_EXTENSION_TIMEOUT_MS = 30_000;

/** Build a context-aware timeout hint for extension tools. */
function buildExtensionTimeoutHint(method: string, timeoutMs?: number): string {
  const effectiveMs = timeoutMs ?? DEFAULT_EXTENSION_TIMEOUT_MS;
  if (timeoutMs != null) {
    return (
      `Extension tool '${method}' timed out after ${effectiveMs}ms (custom timeout). ` +
      "If this exceeds 5 minutes, consider restructuring the tool to start work and return a polling handle rather than blocking the bridge."
    );
  }
  return (
    `Extension tool '${method}' timed out after ${effectiveMs / 1000}s. ` +
    "If this tool calls external services, the extension author can increase timeout_ms in registry.add() options."
  );
}

// After the server starts, discover third-party extensions from the toolkit
// and register them as MCP tools. Also registers discover_tools for
// standard profile — deferred to here so the LLM only ever sees the
// complete description (built-in + extension groups), avoiding stale schemas.
async function discoverExtensions(): Promise<void> {
  let registered = 0;
  let deferredCount = 0;

  try {
    // Call extensions.refresh to force a filesystem scan — picks up
    // externally-created files even when the editor is unfocused.
    // Falls back to extensions.list for older plugins without hot-reload.
    type ExtResult = {
      success?: boolean;
      commands?: {
        method: string;
        description?: string;
        input_schema?: Record<string, unknown>;
        annotations?: Record<string, boolean>;
        group?: { name: string; description?: string; keywords?: string[] };
        timeout_ms?: number;
      }[];
    };
    let result: ExtResult;
    try {
      result = (await bridge.call("extensions.refresh", {}, 5000)) as ExtResult;
    } catch {
      result = (await bridge.call("extensions.list", {}, 5000)) as ExtResult;
    }

    if (result?.success && Array.isArray(result.commands)) {
      // Partition commands: ungrouped → immediate, grouped → deferred.
      // Collect ungrouped for batched registration (1 notification).
      const ungrouped: typeof result.commands = [];
      for (const cmd of result.commands) {
        const toolName = cmd.method.replace(/\./g, "_");
        knownExtensionTools.add(toolName);
        const annotations = {
          readOnlyHint: cmd.annotations?.readOnlyHint ?? false,
          destructiveHint: cmd.annotations?.destructiveHint ?? false,
          idempotentHint: cmd.annotations?.idempotentHint ?? false,
        };
        if (cmd.group?.name) {
          const extCmd: ExtensionCmd = {
            method: cmd.method,
            toolName,
            description: cmd.description || `Extension: ${cmd.method}`,
            inputSchema: cmd.input_schema ?? {},
            annotations,
          };
          addExtensionGroup(cmd.group.name, cmd.group.description ?? "", [extCmd], cmd.group.keywords);
          deferredCount++;
        } else {
          ungrouped.push(cmd);
        }
      }

      // Batch ungrouped extension tool registrations into a single notification.
      // Grouped extensions stay deferred — loaded via discover_tools.
      if (ungrouped.length > 0) {
        batchToolRegistration(server, () => {
          for (const cmd of ungrouped) {
            const toolName = cmd.method.replace(/\./g, "_");
            const annotations = {
              readOnlyHint: cmd.annotations?.readOnlyHint ?? false,
              destructiveHint: cmd.annotations?.destructiveHint ?? false,
              idempotentHint: cmd.annotations?.idempotentHint ?? false,
            };
            // Read-only mode: skip extension tools that aren't read-only.
            if (readOnly && !annotations.readOnlyHint) continue;
            const timeoutMs = cmd.timeout_ms ?? undefined;
            const extensionTimeoutHint = buildExtensionTimeoutHint(cmd.method, timeoutMs);
            registerToolWrapped(
              server,
              bridge,
              toolName,
              {
                description: cmd.description || `Extension: ${cmd.method}`,
                inputSchema: cmd.input_schema ?? {},
                annotations,
              },
              (input: unknown, signal?: AbortSignal) =>
                callAndWrap(bridge, cmd.method, input, {
                  timeoutMs,
                  extensionTimeoutHint,
                  signal,
                }) as Promise<ToolTextResult>,
            );
            registered++;
          }
        });
      }
    }
  } catch {
    // Editor unreachable or extensions.list not available — not an error.
    // Fall through to register discover_tools with built-in groups only.
  }

  // Update discover_tools description to include extension groups.
  // Uses in-place update (1 notification). For the common case
  // (no extensions), discover_tools was already registered at startup.
  if (deferredCount > 0) {
    registerGroupSystem(server, bridge, readOnly);
  }

  if (registered > 0 || deferredCount > 0) {
    const parts: string[] = [];
    if (registered > 0) parts.push(`${registered} registered`);
    if (deferredCount > 0) parts.push(`${deferredCount} deferred in groups`);
    process.stderr.write(`[godot-mcp] extensions: ${parts.join(" + ")}\n`);
  }

  // Always register extensions_refresh — lets the LLM trigger a filesystem
  // rescan after creating/modifying extension files externally.
  if (!hasToolRef("extensions_refresh")) {
    registerToolWrapped(
      server,
      bridge,
      "extensions_refresh",
      {
        description:
          "Force a filesystem rescan and re-discover extension scripts. " +
          "Call after creating, modifying, or deleting extension files from outside the Godot editor. " +
          "Returns the updated list of extension commands.",
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      (input: unknown, signal?: AbortSignal) =>
        callAndWrap(bridge, "extensions.refresh", input, { signal }) as Promise<ToolTextResult>,
    );
  }
}

// ── Live extension reconciliation ───────────────────────────────────

// Tracks currently known extension tool names (method-derived) for diff.
const knownExtensionTools = new Set<string>();

/**
 * Handle "extensions.changed" push notification from the toolkit plugin.
 * Reconciles the tool list: adds new tools, removes old ones, emits exactly
 * one tools/list_changed notification if anything changed.
 */
function handleExtensionsChanged(params?: Record<string, unknown>): void {
  const commands = params?.commands as
    | {
        method: string;
        description?: string;
        input_schema?: Record<string, unknown>;
        annotations?: Record<string, boolean>;
        group?: { name: string; description?: string; keywords?: string[] };
        timeout_ms?: number;
      }[]
    | undefined;
  const removedMethods = (params?.removed as string[]) ?? [];

  if (!Array.isArray(commands)) {
    process.stderr.write("[godot-mcp] extensions.changed: invalid payload (no commands array)\n");
    return;
  }

  let added = 0;
  let removed = 0;

  batchToolRegistration(server, () => {
    // 1. Remove tools for methods listed in 'removed'.
    for (const method of removedMethods) {
      const toolName = method.replace(/\./g, "_");
      if (knownExtensionTools.has(toolName)) {
        // Try grouped removal first, then ungrouped.
        if (!removeExtensionCommand(method)) {
          removeUngroupedExtensionTool(toolName);
        }
        knownExtensionTools.delete(toolName);
        removed++;
      }
    }

    // 2. Register new tools from the current command set.
    const ungrouped: typeof commands = [];
    for (const cmd of commands) {
      const toolName = cmd.method.replace(/\./g, "_");
      if (knownExtensionTools.has(toolName)) continue; // Already registered.

      const annotations = {
        readOnlyHint: cmd.annotations?.readOnlyHint ?? false,
        destructiveHint: cmd.annotations?.destructiveHint ?? false,
        idempotentHint: cmd.annotations?.idempotentHint ?? false,
      };
      if (cmd.group?.name) {
        const extCmd: ExtensionCmd = {
          method: cmd.method,
          toolName,
          description: cmd.description || `Extension: ${cmd.method}`,
          inputSchema: cmd.input_schema ?? {},
          annotations,
        };
        addExtensionGroup(cmd.group.name, cmd.group.description ?? "", [extCmd], cmd.group.keywords);
        knownExtensionTools.add(toolName);
        added++;
      } else {
        ungrouped.push(cmd);
      }
    }

    // Register ungrouped tools immediately (all profiles).
    for (const cmd of ungrouped) {
      const toolName = cmd.method.replace(/\./g, "_");
      if (hasToolRef(toolName)) continue; // Dedup guard.
      const annotations = {
        readOnlyHint: cmd.annotations?.readOnlyHint ?? false,
        destructiveHint: cmd.annotations?.destructiveHint ?? false,
        idempotentHint: cmd.annotations?.idempotentHint ?? false,
      };
      // Read-only mode: skip extension tools that aren't read-only.
      if (readOnly && !annotations.readOnlyHint) continue;
      const timeoutMs = cmd.timeout_ms ?? undefined;
      const extensionTimeoutHint = buildExtensionTimeoutHint(cmd.method, timeoutMs);
      registerToolWrapped(
        server,
        bridge,
        toolName,
        {
          description: cmd.description || `Extension: ${cmd.method}`,
          inputSchema: cmd.input_schema ?? {},
          annotations,
        },
        (input: unknown, signal?: AbortSignal) =>
          callAndWrap(bridge, cmd.method, input, {
            timeoutMs,
            extensionTimeoutHint,
            signal,
          }) as Promise<ToolTextResult>,
      );
      knownExtensionTools.add(toolName);
      added++;
    }
  });

  // Update discover_tools description if extension groups changed.
  if (added > 0 || removed > 0) {
    registerGroupSystem(server, bridge, readOnly);
  }

  if (added > 0 || removed > 0) {
    process.stderr.write(`[godot-mcp] extensions.changed: +${added} -${removed} tools\n`);
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
// Prevent unhandled errors from crashing the bridge process.
// Log to stderr for diagnostics; the bridge stays alive.
process.on("unhandledRejection", (reason) => {
  process.stderr.write(`[godot-mcp] unhandledRejection: ${reason}\n`);
});
process.on("uncaughtException", (err) => {
  process.stderr.write(`[godot-mcp] uncaughtException: ${err?.stack ?? err}\n`);
});

const transport = new StdioServerTransport();
await server.connect(transport);

discoverExtensions().catch(() => {
  // Swallowed — discoverExtensions already handles errors internally.
  // This catch prevents Node's unhandledRejection for edge-case async throws.
});
