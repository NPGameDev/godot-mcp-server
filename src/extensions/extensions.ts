/**
 * Extension subsystem — the lifecycle of third-party extension tools.
 *
 * Owns eager (deadline-wrapped, single-flight) discovery, live reconciliation on
 * the extensions.changed push, the shared ungrouped registrar, and the always-on
 * extensions_refresh tool. The ExtensionManager facade is pure composition: it
 * constructs one shared registrar — which owns the known-extension ledger — then
 * hands that SAME instance to the discovery service (which owns the single-flight
 * latch) and the change-application service (which applies the extensions.changed
 * delta), so the ledger stays one consistency boundary. getReadOnly is injected (a
 * live read of profiles.isReadOnly) so this module imports no other composition
 * module and unit-tests with a fake server + fake bridge.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { createExtensionRegistrar } from "./extensionRegistrar.js";
import { createExtensionDiscovery } from "./extensionDiscovery.js";
import { createExtensionChangeHandler } from "./extensionChanges.js";
import type { Bridge } from "../shared/types.js";

/** The extension subsystem facade — see module header for the owned lifecycle. */
export interface ExtensionManager {
  /** Register the always-on extensions_refresh tool (self-guards via hasToolRef). */
  registerRefreshTool(): void;
  /** Discover + register extensions (single-flight: a concurrent caller joins the in-flight pass). */
  discoverExtensions(): Promise<void>;
  /** Eager boot discovery wrapped in the discovery deadline; resolves {timedOut}. */
  discoverEagerly(deadlineMs?: number): Promise<{ timedOut: boolean }>;
  /** Reconcile the tool list from an extensions.changed push (add/remove/readonly-transition). */
  handleExtensionsChanged(params?: Record<string, unknown>): void;
}

/**
 * Construct the extension manager. getReadOnly is injected (a live read of
 * profiles.isReadOnly) so this module depends on no other composition module —
 * maximising unit-testability with a fake bridge + fake server.
 */
export function createExtensionManager(deps: {
  server: McpServer;
  bridge: Bridge;
  getReadOnly: () => boolean;
}): ExtensionManager {
  const { server, bridge, getReadOnly } = deps;

  // One shared registrar — owns the known-extension ledger + the register-one-tool
  // recipe + the always-on refresh tool. The discovery and change-application
  // services operate on THIS instance, so the ledger stays a single shared
  // consistency boundary (two registrars would fork it).
  const registrar = createExtensionRegistrar({ server, bridge, getReadOnly });

  // The discovery service — the eager, deadline-wrapped, single-flight pull of
  // extensions and their bulk registration. Injected the SAME registrar so its
  // ledger mutations land on the one shared consistency boundary.
  const discovery = createExtensionDiscovery({ server, bridge, getReadOnly, registrar });

  // The change-application service — applies one extensions.changed delta
  // (removed[] + commands) to the live surface. Injected the SAME registrar so its
  // ledger reads/mutations land on the one shared consistency boundary.
  const changes = createExtensionChangeHandler({ server, bridge, getReadOnly, registrar });

  return {
    registerRefreshTool: registrar.registerRefreshTool,
    discoverExtensions: discovery.discoverExtensions,
    discoverEagerly: discovery.discoverEagerly,
    handleExtensionsChanged: changes.handleExtensionsChanged,
  };
}
