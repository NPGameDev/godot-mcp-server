/**
 * Lazy-load tool groups — specialized workflows loaded on demand via
 * enable_tool_group. 6 groups, 22 tools total. Standard profile
 * registers enable_tool_group as the meta-tool; power_user profile
 * registers all group tools at startup.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "./types.js";
import {
  callAndWrap,
  toolErrorFromPayload,
  toolErrorFromException,
  registerToolWrapped,
  batchToolRegistration,
} from "./tool_helpers.js";
import { stableStringify } from "./schema_min.js";
import { isEnabled, envVarFor } from "./feature_gate.js";
import { MUTATING_TOOLS } from "./profiles.js";
import { removeToolByName, updateToolRef, hasToolRef } from "./tool_refs.js";

// Import tool defs from all modules that contribute group tools.
// editorTools is included because scene_close lives in editor.ts
// but belongs to the asset_management group.
import { signalTools } from "./tools/signals.js";
import { animationTools } from "./tools/animation.js";
import { inputMapTools } from "./tools/input_map.js";
import { runtimeTools } from "./tools/runtime.js";
import { assetTools } from "./tools/asset.js";
import { saveTools } from "./tools/save.js";
import { sceneTools } from "./tools/scene.js";
import { fileTools } from "./tools/file.js";
import { resourceTools } from "./tools/resource.js";
import { editorTools } from "./tools/editor.js";

// ── Group definitions ────────────────────────────────────────────────

export type GroupName = "runtime" | "signals" | "animation_authoring" | "input_map" | "asset_management" | "user_data";

const GROUP_NAMES: readonly GroupName[] = [
  "runtime",
  "signals",
  "animation_authoring",
  "input_map",
  "asset_management",
  "user_data",
];

interface GroupDef {
  name: GroupName;
  tools: string[];
  gate?: string; // Feature gate required to load this group
  gateEnvVar?: string;
}

export const GROUPS: GroupDef[] = [
  {
    name: "runtime",
    tools: [
      "runtime_screenshot",
      "runtime_get_node_state",
      "runtime_get_script_vars",
      "debugger_get_log",
      "input_simulate",
      "animation_player_control",
    ],
  },
  {
    name: "signals",
    tools: ["signal_list", "signal_manage", "signal_emit"],
  },
  {
    name: "animation_authoring",
    tools: ["animation_keyframe", "animation_get_keys"],
  },
  {
    name: "input_map",
    tools: ["input_map_action", "input_map_event"],
  },
  {
    name: "asset_management",
    tools: ["asset_get_dependencies", "asset_import", "resource_delete", "file_delete", "scene_delete", "scene_close"],
  },
  {
    name: "user_data",
    tools: ["save_read", "save_write", "save_delete", "save_list"],
    gate: "read_user_scope",
    gateEnvVar: "GODOT_MCP_ALLOW_USER_SCOPE",
  },
];

/** All tool names that belong to groups (for filtering during standard profile registration). */
export const GROUP_TOOL_NAMES = new Set(GROUPS.flatMap((g) => g.tools));

// ── Tool lookup ──────────────────────────────────────────────────────

// Master lookup of all ToolDefs by name, built from modules that
// contribute group tools.
const allDefs = new Map<string, ToolDef>();
for (const tools of [
  signalTools,
  animationTools,
  inputMapTools,
  runtimeTools,
  assetTools,
  saveTools,
  sceneTools,
  fileTools,
  resourceTools,
  editorTools,
]) {
  for (const t of tools) allDefs.set(t.name, t);
}

// Tools that route through the runtime (Mode B) bridge.
const RUNTIME_TOOLS = new Set([
  "runtime_screenshot",
  "runtime_get_node_state",
  "runtime_get_script_vars",
  "debugger_get_log",
  "input_simulate",
  "animation_player_control",
]);

// Tracks loaded groups for the session.
const loadedGroups = new Set<string>();

/** Check whether a group has been loaded this session. */
export function isGroupLoaded(name: string): boolean {
  return loadedGroups.has(name);
}

/** Clear loaded-group tracking (used by config reload). */
export function resetLoadedGroups(): void {
  loadedGroups.clear();
  extensionGroups.clear();
  loadedExtensionGroups.clear();
}

// ── Extension groups (dynamic, from third-party extensions) ─────────

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
  commands: ExtensionCmd[];
}

const extensionGroups = new Map<string, ExtensionGroupDef>();
const loadedExtensionGroups = new Set<string>();

/** Register a deferred extension group (called from discoverExtensions). Deduplicates by method name. */
export function addExtensionGroup(name: string, description: string, commands: ExtensionCmd[]): void {
  const existing = extensionGroups.get(name);
  if (existing) {
    for (const cmd of commands) {
      if (!existing.commands.some((c) => c.method === cmd.method)) {
        existing.commands.push(cmd);
      }
    }
  } else {
    extensionGroups.set(name, { name, description, commands });
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

/** Get all extension group names (for schema description). */
export function getExtensionGroupNames(): string[] {
  return [...extensionGroups.keys()];
}

// ── Special-case handlers ────────────────────────────────────────────
// Tools with non-standard response processing. Each returns a handler
// function matching the registerTool callback signature.

/** signal_emit has dual-mode routing (editor or runtime). */
function handleSignalEmit(bridge: Bridge, def: ToolDef) {
  return async (input: unknown) => {
    const parsed = input as { node_path: string; signal_name: string; args?: unknown[]; mode?: string };
    const mode = parsed.mode ?? "editor";
    const params = { node_path: parsed.node_path, signal_name: parsed.signal_name, args: parsed.args ?? [] };
    return callAndWrap(bridge, def.method, params, { runtime: mode === "runtime" });
  };
}

/** runtime_screenshot returns multi-content (image + text metadata). */
function handleRuntimeScreenshot(bridge: Bridge, def: ToolDef) {
  return async (input: unknown) => {
    try {
      const result = await bridge.callRuntime(def.method, input);
      const err = toolErrorFromPayload(result);
      if (err) return err;
      // Plugin response shape: { image_base64, mime_type, width, height, bytes }
      const obj = result as { image_base64: string; mime_type: string; width: number; height: number; bytes: number };
      return {
        content: [
          { type: "image" as const, data: obj.image_base64, mimeType: obj.mime_type ?? "image/png" },
          {
            type: "text" as const,
            text: JSON.stringify({ width: obj.width, height: obj.height, bytes: obj.bytes }),
          },
        ],
      };
    } catch (err) {
      return toolErrorFromException(err);
    }
  };
}

/** input_simulate normalizes a single event object to an array. */
function handleInputSimulate(bridge: Bridge, def: ToolDef) {
  return async (input: unknown) => {
    const parsed = input as Record<string, unknown>;
    if (parsed.events && !Array.isArray(parsed.events)) {
      parsed.events = [parsed.events];
    }
    return callAndWrap(bridge, def.method, parsed, { runtime: true });
  };
}

/** debugger_get_log prefixes a line-count summary before the payload. */
function handleDebuggerLog(bridge: Bridge, def: ToolDef) {
  return async (input: unknown) => {
    try {
      const result = await bridge.callRuntime(def.method, input);
      const err = toolErrorFromPayload(result);
      if (err) return err;
      const obj = result as Record<string, unknown>;
      const count = typeof obj.count === "number" ? obj.count : 0;
      const total = typeof obj.total === "number" ? obj.total : count;
      const summary = `${count} line${count !== 1 ? "s" : ""} (of ${total} total)`;
      const text = stableStringify({ _summary: summary, ...obj });
      return { content: [{ type: "text" as const, text }] };
    } catch (e) {
      return toolErrorFromException(e);
    }
  };
}

// ── Handler dispatch ─────────────────────────────────────────────────

/**
 * Create the handler for a given tool, respecting runtime routing
 * and special-case tools.
 */
function createHandler(bridge: Bridge, def: ToolDef) {
  switch (def.name) {
    case "signal_emit":
      return handleSignalEmit(bridge, def);
    case "runtime_screenshot":
      return handleRuntimeScreenshot(bridge, def);
    case "input_simulate":
      return handleInputSimulate(bridge, def);
    case "debugger_get_log":
      return handleDebuggerLog(bridge, def);
    default: {
      const useRuntime = RUNTIME_TOOLS.has(def.name);
      return (input: unknown) => callAndWrap(bridge, def.method, input, { runtime: useRuntime });
    }
  }
}

// ── Registration ─────────────────────────────────────────────────────

/**
 * Register a single group's tools dynamically.
 * Removes any LOCKED stubs for those tools first (stub->real swap).
 * Returns the list of newly registered tool names.
 */
function registerGroupTools(server: McpServer, bridge: Bridge, group: GroupDef, readOnly: boolean): string[] {
  const registered: string[] = [];
  for (const toolName of group.tools) {
    if (readOnly && MUTATING_TOOLS.has(toolName)) continue;
    const def = allDefs.get(toolName);
    if (!def) continue;
    removeToolByName(toolName); // Remove stub if present
    registerToolWrapped(
      server,
      bridge,
      def.name,
      {
        description: def.description,
        inputSchema: def.inputSchema,
        annotations: def.annotations,
      },
      createHandler(bridge, def) as (input: Record<string, unknown>) => Promise<import("./types.js").ToolTextResult>,
      { godotMinVersion: def.godotMinVersion },
    );
    registered.push(toolName);
  }
  return registered;
}

// I2 waiver: enable_tool_group description intentionally exceeds the 200-char
// tool-description limit. As the gateway to 22+ hidden tools, discoverability
// is more important than description brevity for this meta-tool.
function buildEnableGroupDesc(): string {
  const parts: string[] = [];
  for (const group of GROUPS) {
    const loaded = loadedGroups.has(group.name);
    const gateBlocked = !!(group.gate && !isEnabled(group.gate));
    let state: string;
    if (loaded) state = "LOADED";
    else if (gateBlocked) state = "GATED";
    else state = "available";

    let entry = `${group.name} [${state}] (${group.tools.join(", ")}`;
    if (group.gateEnvVar && gateBlocked) entry += ` — requires: ${group.gateEnvVar}=1`;
    entry += ")";
    parts.push(entry);
  }

  // Extension groups: description first (primary discoverability hint for LLM).
  const extParts: string[] = [];
  for (const [name, ext] of extensionGroups) {
    const loaded = loadedExtensionGroups.has(name);
    const tools = ext.commands.map((c) => c.toolName).join(", ");
    const desc = ext.description || name;
    extParts.push(`${name} [${loaded ? "LOADED" : "available"}] "${desc}" → ${tools}`);
  }

  let description =
    "Load additional tool groups for specialized workflows. Groups persist for session. Call once with all needed groups. " +
    "Built-in: " +
    parts.join("; ");
  if (extParts.length > 0) {
    description += ". Extensions: " + extParts.join("; ");
  }
  description += ".";
  return description;
}

/** Build the describe text for the groups input schema. */
function buildGroupsDescribe(): string {
  const builtIn = GROUP_NAMES.join(", ");
  const extNames = getExtensionGroupNames();
  if (extNames.length === 0) return `Group names to load: ${builtIn}`;
  return `Group names to load: ${builtIn}, ${extNames.join(", ")}`;
}

/**
 * Register the enable_tool_group meta-tool and its handler.
 * Call this for the standard profile only. Idempotent — if the tool
 * already exists, updates its description in-place (one notification);
 * otherwise registers fresh (also one notification).
 */
export function registerGroupSystem(server: McpServer, bridge: Bridge, readOnly: boolean): void {
  // If already registered, update description in-place (avoids remove+register = 2 notifications).
  if (hasToolRef("enable_tool_group")) {
    updateToolRef("enable_tool_group", { description: buildEnableGroupDesc() });
    return;
  }
  registerToolWrapped(
    server,
    bridge,
    "enable_tool_group",
    {
      description: buildEnableGroupDesc(),
      inputSchema: {
        groups: z.array(z.string()).min(1).describe(buildGroupsDescribe()),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input: Record<string, unknown>) => {
      const { groups: requested } = input as { groups: string[] };
      const results: Record<string, { loaded: boolean; tools?: string[]; error?: string }> = {};

      // Batch all tool registrations into a single notification.
      batchToolRegistration(server, () => {
        for (const groupName of requested) {
          // Already loaded (built-in or extension)?
          if (loadedGroups.has(groupName) || loadedExtensionGroups.has(groupName)) {
            const group = GROUPS.find((g) => g.name === groupName);
            const extGroup = extensionGroups.get(groupName);
            const tools = group?.tools ?? extGroup?.commands.map((c) => c.toolName) ?? [];
            results[groupName] = { loaded: true, tools };
            continue;
          }

          // Check built-in groups first.
          const group = GROUPS.find((g) => g.name === groupName);
          if (group) {
            if (group.gate && !isEnabled(group.gate)) {
              const envVar = group.gateEnvVar ?? envVarFor(group.gate) ?? group.gate;
              results[groupName] = {
                loaded: false,
                error: `Group '${groupName}' requires ${envVar}=1 in .mcp.json env.`,
              };
              continue;
            }
            const registered = registerGroupTools(server, bridge, group, readOnly);
            loadedGroups.add(groupName);
            results[groupName] = { loaded: true, tools: registered };
            continue;
          }

          // Check extension groups.
          const extGroup = extensionGroups.get(groupName);
          if (extGroup) {
            const registered = registerExtGroupTools(server, bridge, extGroup);
            loadedExtensionGroups.add(groupName);
            results[groupName] = { loaded: true, tools: registered };
            continue;
          }

          results[groupName] = { loaded: false, error: `Unknown group: ${groupName}` };
        }
      });

      return {
        content: [{ type: "text" as const, text: JSON.stringify({ success: true, groups: results }) }],
      };
    },
  );
}

/** Register an extension group's tools (called from enable_tool_group handler). */
function registerExtGroupTools(server: McpServer, bridge: Bridge, group: ExtensionGroupDef): string[] {
  const registered: string[] = [];
  for (const cmd of group.commands) {
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
          openWorldHint: cmd.annotations.openWorldHint ?? false,
        },
      },
      (input: unknown) => callAndWrap(bridge, cmd.method, input) as Promise<import("./types.js").ToolTextResult>,
    );
    registered.push(cmd.toolName);
  }
  return registered;
}

/**
 * For power_user profile: register all extension group tools immediately.
 * Batches notifications so only 1 tools/list_changed fires regardless of tool count.
 */
export function registerAllExtensionGroupTools(server: McpServer, bridge: Bridge): void {
  batchToolRegistration(server, () => {
    for (const [name, group] of extensionGroups) {
      if (loadedExtensionGroups.has(name)) continue;
      registerExtGroupTools(server, bridge, group);
      loadedExtensionGroups.add(name);
    }
  });
}

/**
 * For the `power_user` profile: register ALL group tools at startup.
 * No enable_tool_group needed.
 */
export function registerAllGroupTools(server: McpServer, bridge: Bridge, readOnly: boolean): void {
  for (const group of GROUPS) {
    // Skip gated groups whose gate is closed (they get stubs instead)
    if (group.gate && !isEnabled(group.gate)) continue;
    registerGroupTools(server, bridge, group, readOnly);
    loadedGroups.add(group.name);
  }
  // Extension groups are registered via registerAllExtensionGroupTools()
  // after discoverExtensions() completes (they aren't known at startup).
}
