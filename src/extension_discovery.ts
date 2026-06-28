/**
 * Extension discovery — the eager, deadline-wrapped, single-flight pull of
 * third-party extensions from the toolkit and their bulk registration.
 *
 * Owns the single-flight latch (concern 071): a concurrent caller JOINS the
 * in-flight discovery pass rather than starting a second one. Discovery owns
 * nothing else — the register-one-tool recipe, the always-on refresh tool, and
 * the known-extension ledger all live on the INJECTED registrar (the same shared
 * instance the facade hands to change-application), so the ledger stays one
 * consistency boundary; discovery calls registrar.register /
 * registerExtensionTool / registerRefreshTool. getReadOnly is injected (a live
 * read of profiles.isReadOnly) so this module imports no other composition module
 * and unit-tests with a fake server + fake bridge.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerGroupSystem, addExtensionGroup } from "./groups.js";
import { batchToolRegistration } from "./tool_registry.js";
import { extensionAnnotations, toolNameFromMethod, toExtensionCommand } from "./extension_command.js";
import type { ExtensionRegistrar } from "./extension_registrar.js";
import type { ExtensionCmdWire, Bridge } from "./types.js";

// Generous for the editor-running case (<1s); protects against the rare
// hanging-WebSocket-handshake scenario (editor partially started, port
// open but not yet accepting). When the editor is fully down,
// ECONNREFUSED fires in ~50ms — the deadline is irrelevant.
const EXTENSION_DISCOVERY_DEADLINE_MS = 8000;

/** The extension discovery service — see module header for the owned single-flight pull. */
export interface ExtensionDiscovery {
  /** Discover + register extensions (single-flight: a concurrent caller joins the in-flight pass). */
  discoverExtensions(): Promise<void>;
  /** Eager boot discovery wrapped in the discovery deadline; resolves {timedOut}. */
  discoverEagerly(deadlineMs?: number): Promise<{ timedOut: boolean }>;
}

/**
 * Construct the extension discovery service. The registrar is injected (the SAME
 * shared instance the facade hands to change-application) so all ledger mutation
 * lands on one consistency boundary; getReadOnly is injected (a live read of
 * profiles.isReadOnly) so this module depends on no other composition module —
 * maximising unit-testability with a fake bridge + fake server.
 */
export function createExtensionDiscovery(deps: {
  server: McpServer;
  bridge: Bridge;
  getReadOnly: () => boolean;
  registrar: ExtensionRegistrar;
}): ExtensionDiscovery {
  const { server, bridge, getReadOnly, registrar } = deps;

  // Single-flight latch for discoverExtensions (concern 071 follow-up). Holds the
  // currently-running discovery promise so a concurrent caller joins it instead of
  // starting a second pass.
  let discoveryInFlight: Promise<void> | undefined = undefined;

  // Discover third-party extensions from the toolkit and register them as
  // MCP tools. Called eagerly before transport (deadline-wrapped) at startup,
  // and again from handleConfigReload on config changes.
  //
  // Single-flight (concern 071 follow-up): if a discovery is already running,
  // JOIN it rather than start a second concurrent pass. Without this, the eager
  // discovery losing the 8s Promise.race deadline stays in-flight, and the
  // immediate startup reconcile (maybeStartupReconcile → handleConfigReload) would
  // fire a second discoverExtensions() — two concurrent passes issuing duplicate
  // extensions.refresh RPCs and double-registering the same ungrouped tools (a
  // swallowed "already registered" throw + up to 2× tools/list_changed). The latch
  // engages ONLY when a discovery is genuinely concurrent; in the common case and
  // the server-before-editor fast-fail the eager pass settles (and clears the
  // latch) before any reconcile fires, so this is a transparent pass-through.
  //
  // Safe against handleConfigReload's removeAllTools(): a joined pass always
  // registers AFTER the reconcile's synchronous removeAllTools()+module rebuild
  // (the eager pass is still awaiting its RPC when the timeout fires, so it has
  // registered nothing yet), landing the extension tools exactly once on the
  // freshly-rebuilt surface. If a prior pass had already registered, it has
  // settled → the latch is clear → a fresh discovery runs. Either way: registered
  // exactly once. registrar.register() (the ledger add) is idempotent across joins.
  //
  // Accepted residual (deferred fix, post-1.0): a join inherits a FAILING eager
  // pass — if the joined discovery's RPC fails, the reconcile registers zero
  // extensions and consumes its one-shot, so extensions recover only on the next
  // extensions.changed / extensions_refresh / reconnect. Ultra-narrow + self-
  // healing; built-ins unaffected. Deferred fix = retry a fresh pass on an empty join.
  function discoverExtensions(): Promise<void> {
    if (discoveryInFlight) return discoveryInFlight;
    const run = runDiscovery().finally(() => {
      // Clear only if still ours — a later pass may have replaced the latch.
      if (discoveryInFlight === run) discoveryInFlight = undefined;
    });
    discoveryInFlight = run;
    return run;
  }

  async function runDiscovery(): Promise<void> {
    let registered = 0;
    let deferredCount = 0;

    try {
      // Call extensions.refresh to force a filesystem scan — picks up
      // externally-created files even when the editor is unfocused.
      // Falls back to extensions.list for older plugins without hot-reload.
      type ExtResult = {
        success?: boolean;
        commands?: ExtensionCmdWire[];
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
          const toolName = toolNameFromMethod(cmd.method);
          registrar.register(toolName);
          const annotations = extensionAnnotations(cmd);
          if (cmd.group?.name) {
            const extCmd = toExtensionCommand(cmd, annotations);
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
              if (registrar.registerExtensionTool(cmd)) registered++;
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
      registerGroupSystem(server, bridge, getReadOnly());
    }

    if (registered > 0 || deferredCount > 0) {
      const parts: string[] = [];
      if (registered > 0) parts.push(`${registered} registered`);
      if (deferredCount > 0) parts.push(`${deferredCount} deferred in groups`);
      process.stderr.write(`[godot-mcp] extensions: ${parts.join(" + ")}\n`);
    }

    // Defensive re-registration: on the handleConfigReload path,
    // removeAllTools() has cleared extensions_refresh, so re-add it.
    // Delegates to registrar.registerRefreshTool() (self-guards via hasToolRef),
    // which is the same helper used by the startup path.
    registrar.registerRefreshTool();
  }

  function discoverEagerly(deadlineMs = EXTENSION_DISCOVERY_DEADLINE_MS): Promise<{ timedOut: boolean }> {
    // Wrap discovery in the deadline so a slow/hanging editor handshake can't
    // block startup. On deadline or discovery error, the caller (the startup
    // reconcile) re-runs discovery once the version is known (immediately if it
    // already is); the LLM can also call extensions_refresh (always registered).
    return Promise.race([
      discoverExtensions(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("extension discovery deadline")), deadlineMs),
      ),
    ]).then(
      () => ({ timedOut: false }),
      () => ({ timedOut: true }),
    );
  }

  return { discoverExtensions, discoverEagerly };
}
