#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createBridge } from "./bridge.js";
import { getLspStatus, setGodotVersionGetter, type LspStatus } from "./lsp_client.js";
import { setLspStatusReporter } from "./tools/lsp.js";
import { lookupProject } from "./registry.js";
import { resolveAllowedTools, isReadOnly, isExcludedByReadOnly, warnDeprecatedEnvVars } from "./profiles.js";
import {
  registerGroupSystem,
  GROUPS,
  GROUP_TOOL_NAMES,
  resetLoadedGroups,
  addExtensionGroup,
  removeExtensionCommand,
  removeUngroupedExtensionTool,
} from "./groups.js";
import type { ExtensionCmd } from "./groups.js";
import { ALL_TOOL_DEFS, META_TOOL_NAMES } from "./catalogue.js";
import { readMcpJsonEnv, applyEnvUpdate } from "./config_reload.js";
import { removeAllToolRefs, removeToolByName, updateToolRef, toolRefCount, hasToolRef } from "./tool_refs.js";
import { createHookPipeline } from "./hooks.js";
import { getServerVersion } from "./version.js";
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
import * as tileset from "./tools/tileset.js";
import * as classdb from "./tools/classdb.js";
import * as nodeManagement from "./tools/node_management.js";
import * as sceneQuery from "./tools/scene_query.js";
import * as spatial from "./tools/spatial.js";
import * as texture from "./tools/texture.js";
import * as sound from "./tools/sound.js";

// ── Node.js version gate ────────────────────────────────────────────
const [nodeMajor] = process.versions.node.split(".").map(Number);
if (nodeMajor < 20) {
  process.stderr.write(
    `[godot-mcp] Error: requires Node.js >= 20 (found ${process.version}).\n` +
      `Download the latest LTS from https://nodejs.org\n`,
  );
  process.exit(1);
}

// ── --tools-count diagnostic (early exit; no MCP connection or editor) ──
// Static count of the tools the server ships, derived from the canonical
// ALL_TOOL_DEFS. Excludes per-project extension tools (dynamic). Runs before
// any bridge/WebSocket/transport setup so it is editor-independent.
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

// ── Mode resolution ─────────────────────────────────────────────────

warnDeprecatedEnvVars();
let readOnly = isReadOnly();

function buildAllowedTools(): Set<string> {
  return resolveAllowedTools();
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
    editorPort = "6550";
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

// ── Config version check ────────────────────────────────────────────

const EXPECTED_CONFIG_VERSION = 1;
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

// ── Server + hook pipeline ───────────────────────────────────────────

const server = new McpServer(
  { name: "godot-mcp-toolkit", version: getServerVersion() },
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
  tileset.register(server, bridge, ma);
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
  spatial.register(server, bridge, ma);
  texture.register(server, bridge, ma);
  sound.register(server, bridge, ma);
}

function registerGroups(): void {
  // Register discover_tools with built-in groups BEFORE transport
  // connects, so it's in the initial tools/list response — no extra
  // notification needed for the common case (no extensions).
  // If extensions are later discovered, registerGroupSystem is called
  // again (idempotent) which updates the description.
  registerGroupSystem(server, bridge, readOnly);
}

function registerExtensionsRefresh(): void {
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

function logStartup(extTimedOut = false): void {
  const suffix = extTimedOut ? " (ext discovery timed out — extensions_refresh available)" : "";
  process.stderr.write(
    `[godot-mcp] readOnly=${readOnly} tools=${toolRefCount()} hooks=${hookPipeline.length} caps=${scriptReadLimit / 1024}KB/${wsBufferLimit / 1024}KB${suffix}\n`,
  );
}

// Generous for the editor-running case (<1s); protects against the rare
// hanging-WebSocket-handshake scenario (editor partially started, port
// open but not yet accepting). When the editor is fully down,
// ECONNREFUSED fires in ~50ms — the deadline is irrelevant.
const EXTENSION_DISCOVERY_DEADLINE_MS = 8000;

// These must be declared before the module-level await (eager extension
// discovery) to avoid Temporal Dead Zone errors — discoverExtensions()
// and buildExtensionTimeoutHint() reference them during the await.
const DEFAULT_EXTENSION_TIMEOUT_MS = 30_000;
const knownExtensionTools = new Set<string>();

// ── Initial registration ────────────────────────────────────────────

registerModules(moduleAllowed);
registerGroups();
registerExtensionsRefresh(); // always in initial tools/list

// ── Prompts, resources, roots ────────────────────────────────────────

registerPrompts(server);
registerResources(server, bridge);
initRoots(projectPath);
registerRoots(server);

// ── Eager extension discovery ──────────────────────────────────────
// Discover extensions BEFORE transport connects so they're in the
// initial tools/list. Deadline prevents blocking if editor is slow.
// Note: bridge.onNotification is set up AFTER this await, so the
// initial auth-delivered config_reloaded notification is missed —
// but this is benign by design.  The notification handler detects it
// via reconnect===false and early-returns (see below), because tools
// were already registered at startup from the same env vars.

let extDiscoveryTimedOut = false;
try {
  await Promise.race([
    discoverExtensions(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("extension discovery deadline")), EXTENSION_DISCOVERY_DEADLINE_MS),
    ),
  ]);
} catch {
  extDiscoveryTimedOut = true;
  // Deadline or discovery error — if the bridge connects on a later
  // tool call, config_reloaded re-triggers full discovery. LLM can
  // also call extensions_refresh (always registered above).
}

logStartup(extDiscoveryTimedOut);

// ── Live config reload ──────────────────────────────────────────────

function removeAllTools(): void {
  removeAllToolRefs();
  resetLoadedGroups();
}

function handleConfigReload(): void {
  // Re-read .mcp.json for env changes (READ_ONLY, limits, etc.).
  const newEnv = readMcpJsonEnv(projectPath);
  if (newEnv) {
    applyEnvUpdate(newEnv);
  }

  readOnly = isReadOnly();
  allowedTools = buildAllowedTools();
  moduleAllowed = buildModuleAllowed(allowedTools);

  removeAllTools();
  registerModules(moduleAllowed);
  registerGroups();

  process.stderr.write(`[godot-mcp] config reloaded — ${toolRefCount()} tools registered\n`);

  // Re-discover extensions + register discover_tools (the MCP SDK
  // auto-emits tool list notifications on each registerTool call).
  discoverExtensions().catch(() => {});
}

// Debounce config_reloaded to prevent rapid config changes from causing
// overlapping remove+rebuild cycles that leave the tool list empty.
let configReloadTimer: ReturnType<typeof setTimeout> | null = null;
// The first auth-delivered config_reloaded (reconnect=false) is the initial
// config sync.  Suppress tools/list_changed for it — some MCP clients restart
// the server on notifications received within the first second of connection.
let initialAuthSyncDone = false;

// Push the GDScript LSP verdict to the editor dock (editor.set_lsp_status, ADR
// 0008) — the editor can't read its own LSP bind status, so the server reports it.
function sendLspStatus(s: LspStatus): void {
  try {
    void bridge.call("editor.set_lsp_status", s, 3000).catch(() => {});
  } catch {
    /* never let UI status reporting disrupt the bridge */
  }
}

// Verified verdicts from actual LSP tool calls (the real connection result —
// accurate across versions), de-duped so frequent LSP calls don't spam the bridge.
let lastLspKey = "";
setLspStatusReporter((s: LspStatus) => {
  const key = `${s.state}:${s.host}:${s.port}`;
  if (key === lastLspKey) return;
  lastLspKey = key;
  sendLspStatus(s);
});
// Version-tailored LSP conflict hints (4.5+ auto-rebind vs 4.2-4.4 distinct-port).
setGodotVersionGetter(() => bridge.getGodotVersion());

/** On bridge connect/reconnect: push the registry verdict (fast, no LSP
 *  connection) so a freshly-connected editor gets the current status; later LSP
 *  tool calls refine it with the verified result. */
function reportLspStatus(): void {
  const s = getLspStatus(projectPath);
  lastLspKey = `${s.state}:${s.host}:${s.port}`;
  sendLspStatus(s);
}

bridge.onNotification((type, params) => {
  if (type === "config_reloaded") {
    // Push the authoritative LSP verdict to the editor dock (ADR 0008).
    reportLspStatus();
    // Auth-sourced notifications include `reconnect`; plugin-sent ones don't.
    const isInitialAuth = !initialAuthSyncDone && params?.reconnect === false;
    if (params?.reconnect !== undefined) initialAuthSyncDone = true;

    if (isInitialAuth) {
      // On the very first auth of a new bridge process, tools were JUST
      // registered at startup from the same env vars.  Skip tool
      // re-registration to avoid a tools/list_changed notification that
      // can cause some MCP clients to restart or reconnect the bridge.
      process.stderr.write("[godot-mcp] initial auth sync — skipping tool reload to avoid connection bounce\n");
      return;
    }

    if (configReloadTimer) clearTimeout(configReloadTimer);
    configReloadTimer = setTimeout(() => {
      configReloadTimer = null;
      handleConfigReload();
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

// Discover third-party extensions from the toolkit and register them as
// MCP tools. Called eagerly before transport (deadline-wrapped) at startup,
// and again from handleConfigReload on config changes.
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
        min_godot_version?: string;
        max_godot_version?: string;
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
            if (isExcludedByReadOnly(readOnly, annotations)) continue;
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
              {
                godotMinVersion: cmd.min_godot_version,
                godotMaxVersion: cmd.max_godot_version,
              },
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

  // Defensive re-registration: on the handleConfigReload path,
  // removeAllTools() has cleared extensions_refresh, so re-add it.
  // Delegates to registerExtensionsRefresh() (self-guards via hasToolRef),
  // which is the same helper used by the startup path.
  registerExtensionsRefresh();
}

// ── Live extension reconciliation ───────────────────────────────────

// Tracks currently known extension tool names — see declaration above
// the initial-registration section (before the module-level await).

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
        min_godot_version?: string;
        max_godot_version?: string;
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

    // 2. Process current command set — register new tools, reconcile known ones.
    const ungrouped: typeof commands = [];
    for (const cmd of commands) {
      const toolName = cmd.method.replace(/\./g, "_");
      const annotations = {
        readOnlyHint: cmd.annotations?.readOnlyHint ?? false,
        destructiveHint: cmd.annotations?.destructiveHint ?? false,
        idempotentHint: cmd.annotations?.idempotentHint ?? false,
      };

      if (knownExtensionTools.has(toolName)) {
        // Known tool — reconcile annotation/description changes in-place.
        if (!cmd.group?.name) {
          // Ungrouped: update or register/remove based on read-only eligibility.
          const isRegistered = hasToolRef(toolName);
          const shouldBeRegistered = !isExcludedByReadOnly(readOnly, annotations);

          if (isRegistered && !shouldBeRegistered) {
            // Was eligible, now excluded (e.g., readOnlyHint removed in read-only mode).
            removeUngroupedExtensionTool(toolName);
            removed++;
          } else if (!isRegistered && shouldBeRegistered) {
            // Was excluded, now eligible (e.g., readOnlyHint added in read-only mode).
            // Feed into the ungrouped registration path below.
            knownExtensionTools.delete(toolName);
            ungrouped.push(cmd);
          } else if (isRegistered) {
            // Still registered — update description + annotations in-place.
            updateToolRef(toolName, {
              description: cmd.description || `Extension: ${cmd.method}`,
              annotations,
            });
          }
        }
        // Grouped: addExtensionGroup replaces commands, so re-add to pick up changes.
        // Already-loaded group tools are updated via updateToolRef if registered.
        if (cmd.group?.name) {
          const extCmd: ExtensionCmd = {
            method: cmd.method,
            toolName,
            description: cmd.description || `Extension: ${cmd.method}`,
            inputSchema: cmd.input_schema ?? {},
            annotations,
          };
          addExtensionGroup(cmd.group.name, cmd.group.description ?? "", [extCmd], cmd.group.keywords);
          // If the group is loaded and the tool is registered, update in-place.
          if (hasToolRef(toolName)) {
            const shouldBeRegistered = !isExcludedByReadOnly(readOnly, annotations);
            if (!shouldBeRegistered) {
              removeToolByName(toolName);
              removed++;
            } else {
              updateToolRef(toolName, {
                description: cmd.description || `Extension: ${cmd.method}`,
                annotations,
              });
            }
          }
        }
        continue;
      }

      // New tool — partition into grouped/ungrouped.
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

    // Register ungrouped tools (new + newly-eligible from annotation changes).
    for (const cmd of ungrouped) {
      const toolName = cmd.method.replace(/\./g, "_");
      if (hasToolRef(toolName)) continue; // Dedup guard.
      const annotations = {
        readOnlyHint: cmd.annotations?.readOnlyHint ?? false,
        destructiveHint: cmd.annotations?.destructiveHint ?? false,
        idempotentHint: cmd.annotations?.idempotentHint ?? false,
      };
      // Read-only mode: skip extension tools that aren't read-only.
      if (isExcludedByReadOnly(readOnly, annotations)) continue;
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
        {
          godotMinVersion: cmd.min_godot_version,
          godotMaxVersion: cmd.max_godot_version,
        },
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
