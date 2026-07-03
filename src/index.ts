#!/usr/bin/env node
/**
 * Composition root + CLI entry (the npm `bin`). Constructs and wires the whole
 * server in dependency order — bridge, MCP server, hook pipeline, the built-in
 * tool surface, groups, prompts/resources/roots, the extension manager, and the
 * config/version reconciler — then connects the stdio transport LAST so nothing is
 * advertised before its guards are in place.
 *
 * @remarks
 * Owns sequencing and wiring only — no domain logic (that lives in the modules it
 * composes). The ordering is load-bearing: preflight may `process.exit` (Node
 * version check, `--help` / a CLI parse error / `--tools-count`); the transport
 * connects only after the full tool surface and the notification router are ready.
 *
 * @module
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createBridge } from "./transport/bridge.js";
import { isReadOnly } from "./security/profiles.js";
import { toolRefCount } from "./registration/toolRefs.js";
import { createHookPipeline } from "./startup/hooks.js";
import { getServerVersion } from "./shared/version.js";
import { registerPrompts } from "./mcp/prompts.js";
import { registerResources } from "./mcp/resources.js";
import { init as initRoots, registerRoots } from "./mcp/roots.js";
import { setGlobalHookPipeline } from "./registration/toolRegistry.js";
import * as startupEnv from "./startup/startupEnv.js";
import { parseCliArgs } from "./startup/cliArgs.js";
import { resolvePortConfigOrExit, logResolvedPortConfig } from "./startup/portConfig.js";
import { setLspOverride } from "./lsp/lspClient.js";
import { MODULE_ALLOWED } from "./startup/serverMode.js";
import * as registrars from "./startup/registrars.js";
import { createExtensionManager } from "./extensions/extensions.js";
import { createReconciler } from "./startup/reconcile.js";
import { createLspStatusReporter } from "./lsp/lspStatusReporter.js";
import { installProcessHandlers } from "./startup/lifecycle.js";

// ── Preflight (may exit) ─────────────────────────────────────────────
startupEnv.enforceNodeVersion();
const cli = parseCliArgs(process.argv.slice(2));
startupEnv.applyCliMetaGates(cli); // --help / parse error / --tools-count

// ── Bridge setup ─────────────────────────────────────────────────────

const projectPath = process.env.GODOT_MCP_PROJECT_PATH ?? process.cwd();
const ports = resolvePortConfigOrExit(cli, projectPath); // invalid pin → exit 1
logResolvedPortConfig(ports);
const caps = startupEnv.resolveResponseCaps();

// Feed the CLI LSP override into the lazy per-connect LSP resolution (CLI wins
// over env there; env stays live so a config reload can still change it).
setLspOverride({ port: cli.lspPort, host: cli.lspHost });

const bridge = createBridge(`ws://127.0.0.1:${ports.editorPort}`, {
  projectPath,
  explicitRuntimePort: ports.runtimePort,
  explicitEditorPort: ports.editorPinned,
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
// tool. getReadOnly is injected (a live read of profiles.isReadOnly) so extensions.ts
// imports no other composition module.
const extensions = createExtensionManager({ server, bridge, getReadOnly: isReadOnly });

// The reconciler keeps the advertised surface consistent with config + version:
// the debounced config_reloaded reload and the one-shot startup reconcile (concern
// 071). discover is injected (extensions.discoverExtensions, a closure method — no
// `this`) so reconcile.ts imports no other composition module (acyclic graph).
const reconciler = createReconciler({ server, bridge, projectPath, discover: extensions.discoverExtensions });

function logStartup(extTimedOut = false): void {
  const suffix = extTimedOut ? " (ext discovery timed out — extensions_refresh available)" : "";
  process.stderr.write(
    `[godot-mcp] readOnly=${isReadOnly()} tools=${toolRefCount()} hooks=${hookPipeline.length} caps=${caps.scriptReadLimitBytes / 1024}KB/${caps.wsBufferLimitBytes / 1024}KB${suffix}\n`,
  );
}

// ── Initial registration ────────────────────────────────────────────

// Snapshot whether the Godot version is unknown at eager registration. When it
// is, the registration-time version gate filters out version-gated tools
// (scene_close) — leaving the startup surface incomplete. The startup reconcile
// (below) completes it once the version resolves. Pre-populated from the
// registry in the common dogfood flow → false → no reconcile needed.
const versionNullAtEagerRegistration = bridge.getGodotVersion() == null;

registrars.registerBuiltinModules(server, bridge, MODULE_ALLOWED);
registrars.registerGroups(server, bridge, isReadOnly());
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
// was unknown at eager registration, the startup reconcile (armStartupReconcile,
// below) completes the tool surface once the editor is reachable.

const { timedOut } = await extensions.discoverEagerly();

logStartup(timedOut);

// ── Live config reload + notification routing ────────────────────────

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
    // (reconciler.armStartupReconcile), not here. So this is the live reconnect
    // handler: re-read config + re-register tools, debounced (300 ms).
    reconciler.scheduleConfigReload();
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
// Arm the one-shot startup reconcile: the eagerly-registered surface is
// INCOMPLETE when the Godot version was unknown at eager registration
// (version-gated tools like scene_close were filtered) or extension discovery
// timed out (extension tools never registered) — the server-before-editor cold
// start. The reconciler completes it EXACTLY ONCE (immediately if the version is
// already known, else via onGodotVersionKnown) and is a strict no-op when the
// eager surface was already complete. See reconcile.ts for the latch + triggers.
reconciler.armStartupReconcile({ versionNullAtEagerRegistration, extDiscoveryTimedOut: timedOut });

// ── Lifecycle + transport (last) ─────────────────────────────────────

installProcessHandlers(bridge);

const transport = new StdioServerTransport();
await server.connect(transport);
