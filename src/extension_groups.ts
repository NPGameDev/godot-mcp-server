/**
 * Dynamic extension-group registry — the third-party-extension mirror of the
 * static group catalogue. Owns the extensionGroups / loadedExtensionGroups maps
 * (private to this module), their mutators (add + dedupe-by-method, remove,
 * empty-group auto-cleanup), the register / activate / report helpers for
 * extension-sourced tools, and the purpose read accessors the discover_tools
 * orchestrator reads ext state through — the maps never leave this module.
 *
 * Extracted from groups.ts (concern 077, C1): drops the dead
 * registerAllExtensionGroupTools (078) and splits the fused
 * activateOrReportExtGroup into activateExtGroup (command) + reportExtGroupStatus
 * (query — given a readOnly param so it keeps the fused query's read-only
 * tool-filter, symmetric with the built-in reportGroupStatus) (081). Behavior-preserving.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { Bridge } from "./types.js";
import type { ToolMeta, GroupResult } from "./tool_meta.js"; // type-only: no circular runtime dep
import { registerToolWrapped } from "./tool_registry.js";
import { callAndWrap } from "./tool_dispatch.js";
import { removeToolByName } from "./tool_refs.js";
import { isAllowedInReadOnly, isExcludedByReadOnly } from "./profiles.js";

// ── Types ────────────────────────────────────────────────────────────

export interface ExtensionCmd {
  method: string;
  toolName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: Record<string, boolean>;
}

interface ExtensionGroupDef {
  name: string;
  description: string;
  keywords: string[];
  commands: ExtensionCmd[];
}

// ── Registry state (private — read only through the accessors below) ──

const extensionGroups = new Map<string, ExtensionGroupDef>();
const loadedExtensionGroups = new Set<string>();

// ── Mutators ─────────────────────────────────────────────────────────

/** Register a deferred extension group (called from discoverExtensions). Deduplicates by method name. */
export function addExtensionGroup(
  name: string,
  description: string,
  commands: ExtensionCmd[],
  keywords?: string[],
): void {
  const existing = extensionGroups.get(name);
  if (existing) {
    for (const cmd of commands) {
      if (!existing.commands.some((c) => c.method === cmd.method)) {
        existing.commands.push(cmd);
      }
    }
    // Merge description if different.
    if (description && description !== existing.description) {
      existing.description = existing.description + "; " + description;
    }
    // Merge keywords without duplicates.
    if (keywords) {
      for (const kw of keywords) {
        if (!existing.keywords.includes(kw)) existing.keywords.push(kw);
      }
    }
  } else {
    extensionGroups.set(name, { name, description, keywords: keywords ?? [], commands });
  }
}

/** Remove a single command from an extension group by method name. Returns true if found. */
export function removeExtensionCommand(method: string): boolean {
  for (const [name, group] of extensionGroups) {
    const idx = group.commands.findIndex((c) => c.method === method);
    if (idx >= 0) {
      const toolName = group.commands[idx].toolName;
      group.commands.splice(idx, 1);
      removeToolByName(toolName);
      // If no commands remain, remove the entire group.
      if (group.commands.length === 0) {
        extensionGroups.delete(name);
        loadedExtensionGroups.delete(name);
      }
      return true;
    }
  }
  return false;
}

/** Remove an entire extension group by name. Unregisters all its tools. */
export function removeExtensionGroup(name: string): boolean {
  const group = extensionGroups.get(name);
  if (!group) return false;
  for (const cmd of group.commands) {
    removeToolByName(cmd.toolName);
  }
  extensionGroups.delete(name);
  loadedExtensionGroups.delete(name);
  return true;
}

/** Remove an ungrouped extension tool by its method-derived tool name. */
export function removeUngroupedExtensionTool(toolName: string): boolean {
  return removeToolByName(toolName);
}

/** Whether any extension groups exist (used to decide if refresh needed). */
export function hasExtensionGroups(): boolean {
  return extensionGroups.size > 0;
}

// ── Registration ─────────────────────────────────────────────────────

/** Register an extension group's tools (called from discover_tools handler). */
export function registerExtGroupTools(
  server: McpServer,
  bridge: Bridge,
  group: ExtensionGroupDef,
  readOnly: boolean = false,
): string[] {
  const registered: string[] = [];
  for (const cmd of group.commands) {
    if (isExcludedByReadOnly(readOnly, cmd.annotations)) continue;
    registerToolWrapped(
      server,
      bridge,
      cmd.toolName,
      {
        description: cmd.description,
        inputSchema: cmd.inputSchema,
        annotations: {
          readOnlyHint: cmd.annotations.readOnlyHint ?? false,
          destructiveHint: cmd.annotations.destructiveHint ?? false,
          idempotentHint: cmd.annotations.idempotentHint ?? false,
        },
      },
      (input: unknown, signal?: AbortSignal) =>
        callAndWrap(bridge, cmd.method, input, { signal }) as Promise<import("./types.js").ToolTextResult>,
    );
    registered.push(cmd.toolName);
  }
  return registered;
}

// ── Activate / report (the 081 CQS split: command + query) ───────────

/**
 * Activate an extension group by name (the COMMAND half of the old fused
 * activateOrReportExtGroup). Idempotent on an already-loaded group; keeps the
 * read-only "don't waste a slot" guard. The caller dispatches on the activate
 * flag (activate ? activateExtGroup : reportExtGroupStatus).
 */
export function activateExtGroup(
  server: McpServer,
  bridge: Bridge,
  name: string,
  readOnly: boolean = false,
): GroupResult {
  const ext = extensionGroups.get(name);
  if (!ext) {
    return { name, status: "available", tools: [], description: `Unknown group: ${name}` };
  }
  const toolNames = readOnly
    ? ext.commands.filter((c) => isAllowedInReadOnly(c.annotations)).map((c) => c.toolName)
    : ext.commands.map((c) => c.toolName);
  const tools: ToolMeta[] = toolNames.map((t) => ({ name: t }));
  if (loadedExtensionGroups.has(name)) {
    return { name, status: "already_loaded", tools, description: ext.description };
  }
  const registered = registerExtGroupTools(server, bridge, ext, readOnly);
  // In read-only mode, if all tools were filtered out, don't waste a group slot.
  if (readOnly && registered.length === 0) {
    return {
      name,
      status: "available",
      tools: [],
      description: `Group '${name}' has no tools available in read-only mode.`,
    };
  }
  loadedExtensionGroups.add(name);
  return {
    name,
    status: "activated",
    tools: registered.map((t) => ({ name: t })),
    description: ext.description,
  };
}

/** Report an extension group's status without mutating (the QUERY half). */
export function reportExtGroupStatus(name: string, readOnly: boolean = false): GroupResult {
  const ext = extensionGroups.get(name);
  if (!ext) return { name, status: "available", tools: [] };
  // In read-only mode, filter the tool list to only read-only tools (mirrors the built-in reportGroupStatus,
  // preserving the old fused activateOrReportExtGroup query behavior). Browse callers omit readOnly (unfiltered).
  const toolNames = readOnly
    ? ext.commands.filter((c) => isAllowedInReadOnly(c.annotations)).map((c) => c.toolName)
    : ext.commands.map((c) => c.toolName);
  const tools: ToolMeta[] = toolNames.map((t) => ({ name: t }));
  if (loadedExtensionGroups.has(name)) return { name, status: "already_loaded", tools, description: ext.description };
  return { name, status: "available", tools, description: ext.description };
}

// ── Purpose accessors (the maps stay private — DP-S3, the 079 seam) ──

/** Clear both registry maps (used by resetLoadedGroups). */
export function clearExtensionGroups(): void {
  extensionGroups.clear();
  loadedExtensionGroups.clear();
}

/**
 * Unload a loaded extension group: unregister its command tools and clear its
 * loaded flag. Returns true if the group was loaded (now deactivated), false
 * otherwise — so deactivateGroups collects exactly the names it unloaded.
 */
export function deactivateExtensionGroup(name: string): boolean {
  if (!loadedExtensionGroups.has(name)) return false;
  const ext = extensionGroups.get(name);
  if (ext) {
    for (const cmd of ext.commands) removeToolByName(cmd.toolName);
  }
  loadedExtensionGroups.delete(name);
  return true;
}

/** Iterate the registered extension groups (name → def), in insertion order. */
export function extensionGroupEntries(): Iterable<[string, ExtensionGroupDef]> {
  return extensionGroups.entries();
}

/** Look up a registered extension group by name. */
export function getExtensionGroup(name: string): ExtensionGroupDef | undefined {
  return extensionGroups.get(name);
}

/** Whether an extension group is currently loaded (its tools registered). */
export function isExtensionGroupLoaded(name: string): boolean {
  return loadedExtensionGroups.has(name);
}

/** How many extension groups are currently loaded. */
export function loadedExtensionGroupCount(): number {
  return loadedExtensionGroups.size;
}

/** The names of the currently-loaded extension groups, in insertion order. */
export function loadedExtensionGroupNames(): string[] {
  return [...loadedExtensionGroups];
}
