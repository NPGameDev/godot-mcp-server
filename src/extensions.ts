/**
 * Extension subsystem — the lifecycle of third-party extension tools.
 *
 * Owns eager (deadline-wrapped, single-flight) discovery, live reconciliation on
 * the extensions.changed push, the shared ungrouped registrar, and the always-on
 * extensions_refresh tool. The ExtensionManager facade composes one shared
 * registrar — which owns the known-extension ledger — with the discovery service
 * (which owns the single-flight latch); getReadOnly is injected (a live read of profiles.isReadOnly)
 * so this module imports no other composition module and unit-tests with a fake
 * server + fake bridge.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { isExcludedByReadOnly } from "./profiles.js";
import {
  registerGroupSystem,
  addExtensionGroup,
  removeExtensionCommand,
  removeUngroupedExtensionTool,
} from "./groups.js";
import { removeToolByName, updateToolRef, hasToolRef } from "./tool_refs.js";
import { batchToolRegistration } from "./tool_helpers.js";
import { extensionAnnotations, toolNameFromMethod, toExtensionCommand } from "./extension_command.js";
import { createExtensionRegistrar } from "./extension_registrar.js";
import { createExtensionDiscovery } from "./extension_discovery.js";
import type { ExtensionCmdWire, Bridge } from "./types.js";

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
  // recipe + the always-on refresh tool. The discovery service and the still-inline
  // change-application below operate on THIS instance, so the ledger stays a single
  // shared consistency boundary (two registrars would fork it).
  const registrar = createExtensionRegistrar({ server, bridge, getReadOnly });

  // The discovery service — the eager, deadline-wrapped, single-flight pull of
  // extensions and their bulk registration. Injected the SAME registrar so its
  // ledger mutations land on the one shared consistency boundary.
  const discovery = createExtensionDiscovery({ server, bridge, getReadOnly, registrar });

  /**
   * Handle "extensions.changed" push notification from the toolkit plugin.
   * Reconciles the tool list: adds new tools, removes old ones, emits exactly
   * one tools/list_changed notification if anything changed.
   */
  function handleExtensionsChanged(params?: Record<string, unknown>): void {
    const commands = params?.commands as ExtensionCmdWire[] | undefined;
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
        const toolName = toolNameFromMethod(method);
        if (registrar.isRegistered(toolName)) {
          // Try grouped removal first, then ungrouped.
          if (!removeExtensionCommand(method)) {
            removeUngroupedExtensionTool(toolName);
          }
          registrar.deregister(toolName);
          removed++;
        }
      }

      // 2. Process current command set — register new tools, reconcile known ones.
      const ungrouped: typeof commands = [];
      for (const cmd of commands) {
        const toolName = toolNameFromMethod(cmd.method);
        const annotations = extensionAnnotations(cmd);

        if (registrar.isRegistered(toolName)) {
          // Known tool — reconcile annotation/description changes in-place.
          if (!cmd.group?.name) {
            // Ungrouped: update or register/remove based on read-only eligibility.
            const isRegistered = hasToolRef(toolName);
            const shouldBeRegistered = !isExcludedByReadOnly(getReadOnly(), annotations);

            if (isRegistered && !shouldBeRegistered) {
              // Was eligible, now excluded (e.g., readOnlyHint removed in read-only mode).
              removeUngroupedExtensionTool(toolName);
              removed++;
            } else if (!isRegistered && shouldBeRegistered) {
              // Was excluded, now eligible (e.g., readOnlyHint added in read-only mode).
              // Feed into the ungrouped registration path below.
              registrar.deregister(toolName);
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
            const extCmd = toExtensionCommand(cmd, annotations);
            addExtensionGroup(cmd.group.name, cmd.group.description ?? "", [extCmd], cmd.group.keywords);
            // If the group is loaded and the tool is registered, update in-place.
            if (hasToolRef(toolName)) {
              const shouldBeRegistered = !isExcludedByReadOnly(getReadOnly(), annotations);
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
          const extCmd = toExtensionCommand(cmd, annotations);
          addExtensionGroup(cmd.group.name, cmd.group.description ?? "", [extCmd], cmd.group.keywords);
          registrar.register(toolName);
          added++;
        } else {
          ungrouped.push(cmd);
        }
      }

      // Register ungrouped tools (new + newly-eligible from annotation changes).
      for (const cmd of ungrouped) {
        const toolName = toolNameFromMethod(cmd.method);
        if (hasToolRef(toolName)) continue; // Dedup guard.
        if (registrar.registerExtensionTool(cmd)) {
          registrar.register(toolName);
          added++;
        }
      }
    });

    // Update discover_tools description if extension groups changed.
    if (added > 0 || removed > 0) {
      registerGroupSystem(server, bridge, getReadOnly());
    }

    if (added > 0 || removed > 0) {
      process.stderr.write(`[godot-mcp] extensions.changed: +${added} -${removed} tools\n`);
    }
  }

  return {
    registerRefreshTool: registrar.registerRefreshTool,
    discoverExtensions: discovery.discoverExtensions,
    discoverEagerly: discovery.discoverEagerly,
    handleExtensionsChanged,
  };
}
