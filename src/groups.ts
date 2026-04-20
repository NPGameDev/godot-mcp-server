/**
 * Lazy-load tool groups — specialized workflows loaded on demand via
 * enable_tool_group. 6 groups, 22 tools total. Standard/custom profiles
 * register enable_tool_group as the meta-tool; full profile registers
 * all group tools at startup.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "./types.js";
import { callAndWrap, toolErrorFromPayload, toolErrorFromException } from "./types.js";
import { stableStringify } from "./schema_min.js";
import { isEnabled, envVarFor } from "./feature_gate.js";
import { MUTATING_TOOLS } from "./profiles.js";

// Import tool defs from all modules that contribute group tools
import { signalTools } from "./tools/signals.js";
import { animationTools } from "./tools/animation.js";
import { inputMapTools } from "./tools/input_map.js";
import { runtimeTools } from "./tools/runtime.js";
import { assetTools } from "./tools/asset.js";
import { saveTools } from "./tools/save.js";
import { sceneTools } from "./tools/scene.js";
import { fileTools } from "./tools/file.js";
import { resourceTools } from "./tools/resource.js";

export type GroupName = "runtime" | "signals" | "animation_authoring" | "input_map" | "asset_management" | "user_data";

const GROUP_NAMES: readonly GroupName[] = [
  "runtime", "signals", "animation_authoring", "input_map", "asset_management", "user_data",
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
    tools: ["runtime_screenshot", "runtime_get_node_state", "debugger_get_log", "input_simulate", "animation_player_control"],
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
    gate: "input_map_write",
    gateEnvVar: "GODOT_MCP_ALLOW_INPUT_MAP_WRITE",
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
export const GROUP_TOOL_NAMES = new Set(GROUPS.flatMap(g => g.tools));

// Build a master lookup of all ToolDefs by name
const allDefs = new Map<string, ToolDef>();
for (const tools of [signalTools, animationTools, inputMapTools, runtimeTools, assetTools, saveTools, sceneTools, fileTools, resourceTools]) {
  for (const t of tools) allDefs.set(t.name, t);
}

// Tools that route through the runtime (Mode B) bridge
const RUNTIME_TOOLS = new Set([
  "runtime_screenshot", "runtime_get_node_state", "debugger_get_log",
  "input_simulate", "animation_player_control",
]);

// Tracks loaded groups for the session
const loadedGroups = new Set<GroupName>();

/**
 * Create the handler for a given tool, respecting runtime routing
 * and special-case tools.
 */
function createHandler(bridge: Bridge, def: ToolDef) {
  // Special: signal_emit has dual-mode routing
  if (def.name === "signal_emit") {
    return async (input: unknown) => {
      const parsed = input as { node_path: string; signal_name: string; args?: unknown[]; mode?: string };
      const mode = parsed.mode ?? "editor";
      const params = { node_path: parsed.node_path, signal_name: parsed.signal_name, args: parsed.args ?? [] };
      return callAndWrap(bridge, def.method, params, { runtime: mode === "runtime" });
    };
  }

  // Special: runtime_screenshot returns multi-content (image + text)
  if (def.name === "runtime_screenshot") {
    return async (input: unknown) => {
      try {
        const result = await bridge.callRuntime(def.method, input);
        const err = toolErrorFromPayload(result);
        if (err) return err;
        const obj = result as { base64: string; format: string; width: number; height: number };
        return {
          content: [
            { type: "image" as const, data: obj.base64, mimeType: `image/${obj.format}` },
            { type: "text" as const, text: JSON.stringify({ width: obj.width, height: obj.height, format: obj.format }) },
          ],
        };
      } catch (err) {
        return toolErrorFromException(err);
      }
    };
  }

  // Summary-first: debugger_get_log prefixes a line-count summary
  if (def.name === "debugger_get_log") {
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

  // Standard: callAndWrap (with runtime flag if applicable)
  const useRuntime = RUNTIME_TOOLS.has(def.name);
  return (input: unknown) => callAndWrap(bridge, def.method, input, { runtime: useRuntime });
}

/**
 * Register a single group's tools dynamically.
 * Returns the list of newly registered tool names.
 */
function registerGroupTools(
  server: McpServer,
  bridge: Bridge,
  group: GroupDef,
  readOnly: boolean,
): string[] {
  const registered: string[] = [];
  for (const toolName of group.tools) {
    if (readOnly && MUTATING_TOOLS.has(toolName)) continue;
    const def = allDefs.get(toolName);
    if (!def) continue;
    server.registerTool(def.name, {
      description: def.description,
      inputSchema: def.inputSchema,
      annotations: def.annotations,
    }, createHandler(bridge, def));
    registered.push(toolName);
  }
  return registered;
}

/** Description for the enable_tool_group meta-tool (kept under 200 chars not possible here — it's a long description, but it's a meta-tool, so clarity > brevity). */
const ENABLE_GROUP_DESC =
  "Load additional tool groups for specialized workflows. " +
  "Available: runtime, signals, animation_authoring, input_map (gated), asset_management, user_data (gated). " +
  "Groups persist for session. Call once with all needed groups.";

/**
 * Register the enable_tool_group meta-tool and its handler.
 * Call this for standard/custom profiles only.
 */
export function registerGroupSystem(
  server: McpServer,
  bridge: Bridge,
  readOnly: boolean,
): void {
  server.registerTool(
    "enable_tool_group",
    {
      description: ENABLE_GROUP_DESC,
      inputSchema: {
        groups: z.array(z.enum(GROUP_NAMES as unknown as [string, ...string[]])).min(1)
          .describe("Group names to load: runtime, signals, animation_authoring, input_map, asset_management, user_data"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input: unknown) => {
      const { groups: requested } = input as { groups: GroupName[] };
      const results: Record<string, { loaded: boolean; tools?: string[]; error?: string }> = {};
      let anyLoaded = false;

      for (const groupName of requested) {
        // Already loaded — no-op
        if (loadedGroups.has(groupName)) {
          const group = GROUPS.find(g => g.name === groupName)!;
          results[groupName] = { loaded: true, tools: group.tools };
          continue;
        }

        const group = GROUPS.find(g => g.name === groupName);
        if (!group) {
          results[groupName] = { loaded: false, error: `Unknown group: ${groupName}` };
          continue;
        }

        // Check gate requirement
        if (group.gate && !isEnabled(group.gate)) {
          const envVar = group.gateEnvVar ?? envVarFor(group.gate) ?? group.gate;
          results[groupName] = {
            loaded: false,
            error: `Group '${groupName}' requires ${envVar}=1 in .mcp.json env.`,
          };
          continue;
        }

        // Register group tools
        const registered = registerGroupTools(server, bridge, group, readOnly);
        loadedGroups.add(groupName);
        results[groupName] = { loaded: true, tools: registered };
        anyLoaded = true;
      }

      // Notify client of new tools
      if (anyLoaded) {
        server.sendToolListChanged();
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify({ success: true, groups: results }) }],
      };
    },
  );
}

/**
 * For the `full` profile: register ALL group tools at startup.
 * No enable_tool_group needed.
 */
export function registerAllGroupTools(
  server: McpServer,
  bridge: Bridge,
  readOnly: boolean,
): void {
  for (const group of GROUPS) {
    // Skip gated groups whose gate is closed (they get stubs instead)
    if (group.gate && !isEnabled(group.gate)) continue;
    registerGroupTools(server, bridge, group, readOnly);
    loadedGroups.add(group.name);
  }
}
