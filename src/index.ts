#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createBridge } from "./bridge.js";
import { warnDeprecatedEnvVars } from "./profiles.js";
import { resetLoadedGroups } from "./groups.js";
import { readMcpJsonEnv, applyEnvUpdate } from "./config_reload.js";
import { removeAllToolRefs, toolRefCount } from "./tool_refs.js";
import { createHookPipeline } from "./hooks.js";
import { getServerVersion } from "./version.js";
import { registerPrompts } from "./prompts.js";
import { registerResources } from "./resources.js";
import { init as initRoots, registerRoots } from "./roots.js";
import { batchToolRegistration, setGlobalHookPipeline } from "./tool_helpers.js";
import * as startupEnv from "./startup_env.js";
import * as serverMode from "./server_mode.js";
import * as registrars from "./registrars.js";
import { createExtensionManager } from "./extensions.js";
import { createLspStatusReporter } from "./lsp_status_reporter.js";

// ── Preflight (may exit) ─────────────────────────────────────────────
startupEnv.enforceNodeVersion();
startupEnv.maybePrintToolCountAndExit();

// ── Mode resolution ─────────────────────────────────────────────────

warnDeprecatedEnvVars();
serverMode.refreshMode();

// ── Bridge setup ─────────────────────────────────────────────────────

const projectPath = process.env.GODOT_MCP_PROJECT_PATH ?? process.cwd();
const editorPort = startupEnv.resolveEditorPort(projectPath);
const caps = startupEnv.resolveResponseCaps();

const bridge = createBridge(`ws://127.0.0.1:${editorPort}`, {
  projectPath,
  explicitRuntimePort: process.env.GODOT_MCP_RUNTIME_PORT ?? null,
  explicitEditorPort: !!process.env.GODOT_MCP_PORT,
  scriptReadLimitBytes: caps.scriptReadLimitBytes,
  wsBufferLimitBytes: caps.wsBufferLimitBytes,
});

startupEnv.warnConfigVersion();

// ── Server + hook pipeline ───────────────────────────────────────────

const server = new McpServer(
  { name: "godot-mcp-toolkit", version: getServerVersion() },
  {
    capabilities: { tools: { listChanged: true } },
  },
);

const hookPipeline = createHookPipeline();
setGlobalHookPipeline(hookPipeline);

// ── Subsystem construction ───────────────────────────────────────────
// The extension subsystem owns extension discovery (single-flight), live
// reconciliation on extensions.changed, and the always-on extensions_refresh
// tool. getReadOnly is injected (a live read of server_mode) so extensions.ts
// imports no other composition module.
const extensions = createExtensionManager({ server, bridge, getReadOnly: serverMode.getReadOnly });

function logStartup(extTimedOut = false): void {
  const suffix = extTimedOut ? " (ext discovery timed out — extensions_refresh available)" : "";
  process.stderr.write(
    `[godot-mcp] readOnly=${serverMode.getReadOnly()} tools=${toolRefCount()} hooks=${hookPipeline.length} caps=${caps.scriptReadLimitBytes / 1024}KB/${caps.wsBufferLimitBytes / 1024}KB${suffix}\n`,
  );
}

// ── Initial registration ────────────────────────────────────────────

// Snapshot whether the Godot version is unknown at eager registration. When it
// is, the registration-time version gate filters out version-gated tools
// (scene_close) — leaving the startup surface incomplete. The startup reconcile
// (below) completes it once the version resolves. Pre-populated from the
// registry in the common dogfood flow → false → no reconcile needed.
const versionNullAtEagerRegistration = bridge.getGodotVersion() == null;

registrars.registerBuiltinModules(server, bridge, serverMode.getModuleAllowed());
registrars.registerGroups(server, bridge, serverMode.getReadOnly());
extensions.registerRefreshTool(); // always in initial tools/list

// ── Prompts, resources, roots ────────────────────────────────────────

registerPrompts(server);
registerResources(server, bridge);
initRoots(projectPath);
registerRoots(server);

// ── Eager extension discovery ──────────────────────────────────────
// Discover extensions BEFORE transport connects so they're in the
// initial tools/list. Deadline prevents blocking if editor is slow.
// Note: the editor's FIRST connect delivers no notification (config_reloaded
// is reconnect-only — see bridge.ts performAuth). The version becomes known
// via bridge.onGodotVersionKnown; if discovery timed out here or the version
// was unknown at eager registration, the startup reconcile (maybeStartupReconcile,
// below) completes the tool surface once the editor is reachable.

const { timedOut } = await extensions.discoverEagerly();

logStartup(timedOut);

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

  serverMode.refreshMode();

  // Collapse the remove+rebuild into a SINGLE tools/list_changed. The SDK
  // auto-emits on every ref.remove() (in removeAllTools) and every registerTool
  // (in registrars.registerBuiltinModules/registerGroups); batching suppresses those per-op
  // notifications and fires exactly one when the rebuild completes, so the
  // client never observes the transient empty/partial tool list mid-reload.
  batchToolRegistration(server, () => {
    removeAllTools();
    registrars.registerBuiltinModules(server, bridge, serverMode.getModuleAllowed());
    registrars.registerGroups(server, bridge, serverMode.getReadOnly());
  });

  process.stderr.write(`[godot-mcp] config reloaded — ${toolRefCount()} tools registered\n`);

  // Re-discover extensions + register discover_tools. Runs AFTER and OUTSIDE
  // the batch above: it is async (batchToolRegistration is synchronous and would
  // restore sendToolListChanged before the async work ran), and it batches its
  // bulk (ungrouped) extension registrations internally — so it reconciles the
  // extension surface with only a few discrete notifications (the ungrouped
  // batch, the discover_tools update, the extensions_refresh re-add), never a
  // per-registration burst.
  extensions.discoverExtensions().catch(() => {});
}

// Debounce config_reloaded to prevent rapid config changes from causing
// overlapping remove+rebuild cycles that leave the tool list empty.
let configReloadTimer: ReturnType<typeof setTimeout> | null = null;

// LSP status reporter — pushes the GDScript-LSP verdict to the editor dock (ADR
// 0008), de-duped. Constructed here so its setLspStatusReporter +
// setGodotVersionGetter wiring fires before transport connect; the notification
// router below calls reportRegistryVerdict() on reconnect.
const lspReporter = createLspStatusReporter({ bridge, projectPath });

bridge.onNotification((type, params) => {
  if (type === "config_reloaded") {
    // Push the authoritative LSP verdict to the editor dock (ADR 0008).
    lspReporter.reportRegistryVerdict();
    // config_reloaded is only ever emitted on a RECONNECT ({reconnect:true},
    // bridge.ts performAuth) — the editor's FIRST connect sends no notification.
    // An incomplete first-connect surface is completed by the startup reconcile
    // (maybeStartupReconcile), not here. So this is the live reconnect handler:
    // re-read config + re-register tools, debounced.
    if (configReloadTimer) clearTimeout(configReloadTimer);
    configReloadTimer = setTimeout(() => {
      configReloadTimer = null;
      handleConfigReload();
    }, 300);
  } else if (type === "extensions.changed") {
    extensions.handleExtensionsChanged(params);
  } else if (type === "game_stopped") {
    // Proactive runtime teardown: editor detected game-stop/crash and
    // notified us. Clear the runtime channel immediately so the next
    // callRuntime() fails with GAME_NOT_RUNNING in 0ms (no TCP probe).
    bridge.clearRuntime?.();
  }
});

// ── Startup reconcile (concern 071) ──────────────────────────────────
// The eagerly-registered tool surface is INCOMPLETE when the Godot version was
// unknown at eager registration (version-gated tools like scene_close were
// filtered out) or extension discovery timed out (extension tools never
// registered) — the classic server-before-editor cold start. Complete it
// EXACTLY ONCE: immediately if the version is already known (slow/timed-out
// discovery), or when it resolves later via the version-resolved hook
// (server-before-editor). In the common dogfood case the surface is already
// complete (version pre-populated + discovery succeeded) → needsStartupReconcile
// is false → this is a strict no-op: no reconcile, no extra tools/list_changed.
const startupSurfaceIncomplete = versionNullAtEagerRegistration || timedOut;
let needsStartupReconcile = startupSurfaceIncomplete;
function maybeStartupReconcile(): void {
  if (!needsStartupReconcile || bridge.getGodotVersion() == null) return;
  needsStartupReconcile = false; // one-shot; also dedups reconnect re-deliveries
  handleConfigReload(); // re-register (known version) + re-discover, already batched
}
maybeStartupReconcile(); // version already known (slow/timed-out discovery)
bridge.onGodotVersionKnown(maybeStartupReconcile); // version known later (server-before-editor)

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
