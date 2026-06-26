/**
 * Extension change-application — apply one extensions.changed delta to the live
 * tool surface.
 *
 * Reconciles an incremental push (removed[] + commands) inside a single
 * batchToolRegistration so the whole delta collapses to exactly one
 * tools/list_changed: it removes dropped tools, registers new ones, updates known
 * ones in-place, and handles read-only eligibility transitions. Owns no state —
 * the known-extension ledger lives on the INJECTED registrar (the same shared
 * instance the facade hands to discovery), so the ledger stays one consistency
 * boundary; change-application calls registrar.isRegistered / register /
 * deregister / registerExtensionTool. getReadOnly is injected (a live read of
 * profiles.isReadOnly) so this module imports no other composition module and
 * unit-tests with a fake server + fake bridge.
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
import { batchToolRegistration } from "./tool_registry.js";
import { extensionAnnotations, toolNameFromMethod, toExtensionCommand } from "./extension_command.js";
import type { ExtensionRegistrar } from "./extension_registrar.js";
import type { ExtensionCmdWire, Bridge } from "./types.js";

/** The extension change-application service — see module header for the owned delta apply. */
export interface ExtensionChangeHandler {
  /** Reconcile the tool list from an extensions.changed push (add/remove/readonly-transition). */
  handleExtensionsChanged(params?: Record<string, unknown>): void;
}

/**
 * Construct the extension change-application service. The registrar is injected
 * (the SAME shared instance the facade hands to discovery) so all ledger reads and
 * mutations land on one consistency boundary; getReadOnly is injected (a live read
 * of profiles.isReadOnly) so this module depends on no other composition module —
 * maximising unit-testability with a fake bridge + fake server.
 */
export function createExtensionChangeHandler(deps: {
  server: McpServer;
  bridge: Bridge;
  getReadOnly: () => boolean;
  registrar: ExtensionRegistrar;
}): ExtensionChangeHandler {
  const { server, bridge, getReadOnly, registrar } = deps;

  /**
   * Handle "extensions.changed" push notification from the toolkit plugin.
   * Reconciles the tool list inside one batchToolRegistration — adds new tools,
   * removes dropped ones, updates known ones in-place — so the delta collapses to
   * a single tools/list_changed; a following discover_tools description refresh
   * (registerGroupSystem, only when something changed) may emit one more.
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
            const isToolRegistered = hasToolRef(toolName);
            const shouldBeRegistered = !isExcludedByReadOnly(getReadOnly(), annotations);

            if (isToolRegistered && !shouldBeRegistered) {
              // Was eligible, now excluded (e.g., readOnlyHint removed in read-only mode).
              removeUngroupedExtensionTool(toolName);
              removed++;
            } else if (!isToolRegistered && shouldBeRegistered) {
              // Was excluded, now eligible (e.g., readOnlyHint added in read-only mode).
              // Feed into the ungrouped registration path below.
              registrar.deregister(toolName);
              ungrouped.push(cmd);
            } else if (isToolRegistered) {
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

  return { handleExtensionsChanged };
}
