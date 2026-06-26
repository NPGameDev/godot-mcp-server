/**
 * Extension subsystem — the lifecycle of third-party extension tools.
 *
 * Owns eager (deadline-wrapped, single-flight) discovery, live reconciliation on
 * the extensions.changed push, the shared ungrouped registrar, and the always-on
 * extensions_refresh tool. The ExtensionManager facade composes them over closure
 * state (knownExtensionTools + the discovery single-flight latch); getReadOnly is
 * injected (a live read of profiles.isReadOnly) so this module imports no other
 * composition module and unit-tests with a fake server + fake bridge.
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
import { callAndWrap, registerToolWrapped, batchToolRegistration } from "./tool_helpers.js";
import { extensionAnnotations, toolNameFromMethod, toExtensionCommand } from "./extension_command.js";
import type { ToolTextResult, ExtensionCmdWire, Bridge } from "./types.js";

// Generous for the editor-running case (<1s); protects against the rare
// hanging-WebSocket-handshake scenario (editor partially started, port
// open but not yet accepting). When the editor is fully down,
// ECONNREFUSED fires in ~50ms — the deadline is irrelevant.
const EXTENSION_DISCOVERY_DEADLINE_MS = 8000;

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

  const knownExtensionTools = new Set<string>();
  // Single-flight latch for discoverExtensions (concern 071 follow-up). Holds the
  // currently-running discovery promise so a concurrent caller joins it instead of
  // starting a second pass.
  let discoveryInFlight: Promise<void> | null = null;

  function registerRefreshTool(): void {
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

  /**
   * Register one ungrouped extension command as an MCP tool. Returns true when the
   * tool was registered, false when skipped by read-only exclusion. Callers own
   * their own pre-checks (dedup guard), counters, and knownExtensionTools
   * bookkeeping — this encapsulates only the shared registration recipe common to
   * the eager-discovery and live-reconciliation ungrouped paths.
   */
  function registerExtensionTool(cmd: ExtensionCmdWire): boolean {
    const toolName = toolNameFromMethod(cmd.method);
    const annotations = extensionAnnotations(cmd);
    // Read-only mode: skip extension tools that aren't read-only.
    if (isExcludedByReadOnly(getReadOnly(), annotations)) return false;
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
    return true;
  }

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
  // exactly once. knownExtensionTools.add() is idempotent across joins.
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
      if (discoveryInFlight === run) discoveryInFlight = null;
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
          knownExtensionTools.add(toolName);
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
              if (registerExtensionTool(cmd)) registered++;
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
    // Delegates to registerRefreshTool() (self-guards via hasToolRef),
    // which is the same helper used by the startup path.
    registerRefreshTool();
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
        const toolName = toolNameFromMethod(cmd.method);
        const annotations = extensionAnnotations(cmd);

        if (knownExtensionTools.has(toolName)) {
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
          knownExtensionTools.add(toolName);
          added++;
        } else {
          ungrouped.push(cmd);
        }
      }

      // Register ungrouped tools (new + newly-eligible from annotation changes).
      for (const cmd of ungrouped) {
        const toolName = toolNameFromMethod(cmd.method);
        if (hasToolRef(toolName)) continue; // Dedup guard.
        if (registerExtensionTool(cmd)) {
          knownExtensionTools.add(toolName);
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

  return { registerRefreshTool, discoverExtensions, discoverEagerly, handleExtensionsChanged };
}
