/**
 * Extension registrar — the aggregate root of the extension subsystem.
 *
 * Owns the known-extension ledger (the membership Set behind register /
 * isRegistered / deregister — never exposed as a raw Set), the shared
 * register-one-ungrouped-tool recipe (registerExtensionTool), and the always-on
 * extensions_refresh tool. The discovery and change-application services share a
 * SINGLE registrar instance so the ledger stays one consistency boundary;
 * getReadOnly is injected (a live read of profiles.isReadOnly) so this module
 * imports no other composition module and unit-tests with a fake server + fake
 * bridge.
 *
 * Note the deliberate register/track separation: registerExtensionTool registers
 * a tool WITH THE MCP SERVER but does NOT record ledger membership — callers own
 * the ledger bookkeeping via register/deregister. The two register-family
 * operations are disambiguated on the interface below.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { isExcludedByReadOnly } from "./profiles.js";
import { hasToolRef } from "./tool_refs.js";
import { callAndWrap, registerToolWrapped } from "./tool_helpers.js";
import { extensionAnnotations, toolNameFromMethod } from "./extension_command.js";
import type { ToolTextResult, ExtensionCmdWire, Bridge } from "./types.js";

const DEFAULT_EXTENSION_TIMEOUT_MS = 30_000;

/** The extension registrar — owns the ledger + the register recipe + the refresh tool. */
export interface ExtensionRegistrar {
  /**
   * Register one ungrouped extension command WITH THE MCP SERVER (the registration
   * recipe): applies the read-only filter, the timeout hint, and the version gate.
   * Returns true when the tool was registered, false when skipped by read-only
   * exclusion. Does NOT record ledger membership — this is the register half of the
   * deliberate register/track separation; callers own the ledger bookkeeping via
   * register/deregister below.
   */
  registerExtensionTool(cmd: ExtensionCmdWire): boolean;
  /** Register the always-on extensions_refresh tool (self-guards via hasToolRef). */
  registerRefreshTool(): void;
  /**
   * Record a tool name as a member of the known-extension ledger (was
   * knownExtensionTools.add). This is the track half of the register/track
   * separation — it updates ledger membership only; it does NOT register anything
   * with the MCP server (use registerExtensionTool for that).
   */
  register(toolName: string): void;
  /** Whether a tool name is currently a member of the known-extension ledger. */
  isRegistered(toolName: string): boolean;
  /** Remove a tool name from the known-extension ledger (was knownExtensionTools.delete). */
  deregister(toolName: string): void;
}

/**
 * Construct the extension registrar. getReadOnly is injected (a live read of
 * profiles.isReadOnly) so this module depends on no other composition module —
 * maximising unit-testability with a fake bridge + fake server.
 */
export function createExtensionRegistrar(deps: {
  server: McpServer;
  bridge: Bridge;
  getReadOnly: () => boolean;
}): ExtensionRegistrar {
  const { server, bridge, getReadOnly } = deps;

  // The known-extension ledger: the names the subsystem currently considers
  // registered. The raw Set is never exposed — all access goes through the
  // register / isRegistered / deregister accessors below.
  const knownExtensionTools = new Set<string>();

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

  function register(toolName: string): void {
    knownExtensionTools.add(toolName);
  }

  function isRegistered(toolName: string): boolean {
    return knownExtensionTools.has(toolName);
  }

  function deregister(toolName: string): void {
    knownExtensionTools.delete(toolName);
  }

  return { registerExtensionTool, registerRefreshTool, register, isRegistered, deregister };
}
