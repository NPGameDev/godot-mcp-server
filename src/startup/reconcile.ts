/**
 * Reconciler — keeps the advertised tool surface consistent with config + version.
 *
 * Two entry points:
 *   - The debounced config_reloaded reload (re-read .mcp.json env → batched
 *     rebuild of the built-in surface → re-discover extensions).
 *   - The one-shot startup reconcile that completes a cold-start surface once the
 *     Godot version resolves.
 *
 * discover is injected (the ExtensionManager's discoverExtensions) so this module
 * does not import extensions.ts — keeping the dependency graph acyclic and the
 * construction order linear.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { MODULE_ALLOWED } from "./serverMode.js";
import { isReadOnly } from "../security/profiles.js";
import * as registrars from "./registrars.js";
import { readMcpJsonEnv, applyEnvUpdate } from "./configReload.js";
import { batchToolRegistration } from "../registration/toolRegistry.js";
import { removeAllToolRefs, toolRefCount } from "../registration/toolRefs.js";
import { resetLoadedGroups } from "../groups/groups.js";
import type { Bridge } from "../shared/types.js";

export interface Reconciler {
  /** Re-read .mcp.json env → batched rebuild of the built-in surface → re-discover extensions.
   *  Synchronous rebuild collapsed into ONE tools/list_changed; extension re-discovery runs after/outside. */
  handleConfigReload(): void;
  /** Debounced (300 ms) entry for the config_reloaded notification. */
  scheduleConfigReload(): void;
  /** Arm the one-shot startup reconcile: complete the surface now if the version is known, else on the
   *  version-resolved hook. No-op when the eager surface was already complete. */
  armStartupReconcile(opts: { versionNullAtEagerRegistration: boolean; extDiscoveryTimedOut: boolean }): void;
}

/**
 * Construct the reconciler. discover is injected (the ExtensionManager's
 * discoverExtensions) so this module does not import extensions.ts — keeping the
 * dependency graph acyclic and the construction order linear.
 */
export function createReconciler(deps: {
  server: McpServer;
  bridge: Bridge & { onGodotVersionKnown(handler: () => void): void };
  projectPath: string;
  discover: () => Promise<void>;
}): Reconciler {
  const { server, bridge, projectPath, discover } = deps;

  // Debounce config_reloaded to prevent rapid config changes from causing
  // overlapping remove+rebuild cycles that leave the tool list empty.
  let configReloadTimer: ReturnType<typeof setTimeout> | undefined = undefined;
  // One-shot latch for the startup reconcile. Set by armStartupReconcile,
  // cleared on the first effective reconcile.
  let needsStartupReconcile = false;

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

    // Collapse the remove+rebuild into a SINGLE tools/list_changed. The SDK
    // auto-emits on every ref.remove() (in removeAllTools) and every registerTool
    // (in registrars.registerBuiltinModules/registerGroups); batching suppresses those per-op
    // notifications and fires exactly one when the rebuild completes, so the
    // client never observes the transient empty/partial tool list mid-reload.
    batchToolRegistration(server, () => {
      removeAllTools();
      registrars.registerBuiltinModules(server, bridge, MODULE_ALLOWED);
      registrars.registerGroups(server, bridge, isReadOnly());
    });

    process.stderr.write(`[godot-mcp] config reloaded — ${toolRefCount()} tools registered\n`);

    // Re-discover extensions + register discover_tools. Runs AFTER and OUTSIDE
    // the batch above: it is async (batchToolRegistration is synchronous and would
    // restore sendToolListChanged before the async work ran), and it batches its
    // bulk (ungrouped) extension registrations internally — so it reconciles the
    // extension surface with only a few discrete notifications (the ungrouped
    // batch, the discover_tools update, the extensions_refresh re-add), never a
    // per-registration burst.
    discover().catch(() => {});
  }

  function scheduleConfigReload(): void {
    if (configReloadTimer) clearTimeout(configReloadTimer);
    configReloadTimer = setTimeout(() => {
      configReloadTimer = undefined;
      handleConfigReload();
    }, 300);
  }

  // ── Startup reconcile ──────────────────────────────────
  // The eagerly-registered tool surface is INCOMPLETE when the Godot version was
  // unknown at eager registration (version-gated tools like scene_close were
  // filtered out) or extension discovery timed out (extension tools never
  // registered) — the classic server-before-editor cold start. Complete it
  // EXACTLY ONCE: immediately if the version is already known (slow/timed-out
  // discovery), or when it resolves later via the version-resolved hook
  // (server-before-editor). In the common dogfood case the surface is already
  // complete (version pre-populated + discovery succeeded) → needsStartupReconcile
  // is false → this is a strict no-op: no reconcile, no extra tools/list_changed.
  function armStartupReconcile(opts: { versionNullAtEagerRegistration: boolean; extDiscoveryTimedOut: boolean }): void {
    needsStartupReconcile = opts.versionNullAtEagerRegistration || opts.extDiscoveryTimedOut;
    function maybeStartupReconcile(): void {
      if (!needsStartupReconcile || bridge.getGodotVersion() == null) return;
      needsStartupReconcile = false; // one-shot; also dedups reconnect re-deliveries
      handleConfigReload(); // re-register (known version) + re-discover, already batched
    }
    maybeStartupReconcile(); // version already known (slow/timed-out discovery)
    bridge.onGodotVersionKnown(maybeStartupReconcile); // version known later (server-before-editor)
  }

  return { handleConfigReload, scheduleConfigReload, armStartupReconcile };
}
