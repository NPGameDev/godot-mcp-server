/**
 * Lazy-load tool groups — specialized workflows loaded on demand via
 * enable_tool_group. 6 groups, 22 tools total. Standard profile
 * registers enable_tool_group as the meta-tool; power_user profile
 * registers all group tools at startup.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "./types.js";
import { callAndWrap, toolErrorFromPayload, toolErrorFromException } from "./tool_helpers.js";
import { stableStringify } from "./schema_min.js";
import { isEnabled, envVarFor } from "./feature_gate.js";
import type { ProfileName } from "./profiles.js";
import { MUTATING_TOOLS } from "./profiles.js";
import { removeToolByName } from "./tool_refs.js";

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
  "debugger_get_log",
  "input_simulate",
  "animation_player_control",
]);

// Tracks loaded groups for the session.
const loadedGroups = new Set<GroupName>();

/** Check whether a group has been loaded this session. */
export function isGroupLoaded(name: GroupName): boolean {
  return loadedGroups.has(name);
}

/** Clear loaded-group tracking (used by config reload). */
export function resetLoadedGroups(): void {
  loadedGroups.clear();
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
    case "debugger_get_log":
      return handleDebuggerLog(bridge, def);
    default: {
      const useRuntime = RUNTIME_TOOLS.has(def.name);
      return (input: unknown) => callAndWrap(bridge, def.method, input, { runtime: useRuntime });
    }
  }
}

// ── Group tool stubs ────────────────────────────────────────────────

/** One-line descriptions for group tool LOCKED stubs. */
const GROUP_TOOL_ONE_LINERS: Record<string, string> = {
  runtime_screenshot: "capture frame from running game viewport",
  runtime_get_node_state: "inspect live node in running game",
  debugger_get_log: "read output from running game",
  input_simulate: "inject input events into running game",
  animation_player_control: "drive AnimationPlayer in running game",
  signal_list: "list signals on a node",
  signal_manage: "connect or disconnect signals",
  signal_emit: "emit a signal on a node",
  animation_keyframe: "add/modify animation keyframes",
  animation_get_keys: "read animation track keyframes",
  input_map_action: "add/remove InputMap actions",
  input_map_event: "bind/unbind InputMap events",
  asset_get_dependencies: "list resource dependencies",
  asset_import: "reimport assets",
  resource_delete: "delete a resource file",
  file_delete: "delete a file from the project",
  scene_delete: "delete a scene file",
  scene_close: "close an open scene tab",
  save_read: "read user save data",
  save_write: "write user save data",
  save_delete: "delete user save data",
  save_list: "list user save files",
};

/**
 * Register LOCKED stubs for all group tools not yet loaded.
 * - minimal: all 22 group tools always stubbed (profile is the blocker)
 * - standard: all 22 stubbed at startup (groups lazy-load via enable_tool_group)
 * - power_user: only gated groups whose gate is closed get stubs
 * Called from index.ts registerGroups() after registerGroupSystem /
 * registerAllGroupTools so loadedGroups is already populated.
 */
export function registerGroupStubs(server: McpServer, profile: ProfileName, readOnly: boolean): void {
  for (const group of GROUPS) {
    if (loadedGroups.has(group.name)) continue;

    for (const toolName of group.tools) {
      // Minimal: always stub all group tools (profile is the blocker, readOnly irrelevant)
      // Standard/power_user: skip mutating tools in readOnly mode
      if (profile !== "minimal" && readOnly && MUTATING_TOOLS.has(toolName)) continue;

      const oneLiner = GROUP_TOOL_ONE_LINERS[toolName] ?? toolName;
      let description: string;
      let errorMsg: string;
      let code: string;
      let hint: string;

      if (profile === "minimal") {
        description = `LOCKED — ${oneLiner}. Standard/Power User profile.`;
        errorMsg = "Not available in Minimal profile.";
        code = "PROFILE_LOCKED";
        hint = "Set GODOT_MCP_PROFILE=standard in .mcp.json env.";
      } else {
        const gateBlocked = group.gate != null && !isEnabled(group.gate);
        if (gateBlocked) {
          const envVar = group.gateEnvVar ?? envVarFor(group.gate!) ?? group.gate!;
          description = `LOCKED — ${oneLiner}. Gate: ${envVar}, Group: ${group.name}.`;
          errorMsg = `Feature gated — ${envVar} is not enabled.`;
          code = "FEATURE_GATED";
          hint = `Set ${envVar}=1 in .mcp.json env, then call enable_tool_group('${group.name}').`;
        } else {
          description = `LOCKED — ${oneLiner}. Group: ${group.name}.`;
          errorMsg = `Group not loaded.`;
          code = "GROUP_NOT_LOADED";
          hint = `Call enable_tool_group('${group.name}').`;
        }
      }

      server.registerTool(toolName, { description, annotations: { openWorldHint: false } }, async () => ({
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ success: false, error: errorMsg, code, hint }),
          },
        ],
        isError: true,
      }));
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
    server.registerTool(
      def.name,
      {
        description: def.description,
        inputSchema: def.inputSchema,
        annotations: def.annotations,
      },
      createHandler(bridge, def),
    );
    registered.push(toolName);
  }
  return registered;
}

// I2 waiver: enable_tool_group description intentionally exceeds the 200-char
// tool-description limit. As the gateway to 22 hidden tools, discoverability
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
  return (
    "Load additional tool groups for specialized workflows. Groups persist for session. Call once with all needed groups. " +
    "Groups: " +
    parts.join(", ") +
    "."
  );
}

/**
 * Register the enable_tool_group meta-tool and its handler.
 * Call this for the standard profile only.
 */
export function registerGroupSystem(server: McpServer, bridge: Bridge, readOnly: boolean): void {
  server.registerTool(
    "enable_tool_group",
    {
      description: buildEnableGroupDesc(),
      inputSchema: {
        groups: z
          .array(z.enum(GROUP_NAMES as unknown as [string, ...string[]]))
          .min(1)
          .describe(
            "Group names to load: runtime, signals, animation_authoring, input_map, asset_management, user_data",
          ),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input: unknown) => {
      const { groups: requested } = input as { groups: GroupName[] };
      const results: Record<string, { loaded: boolean; tools?: string[]; error?: string }> = {};
      let anyLoaded = false;

      for (const groupName of requested) {
        if (loadedGroups.has(groupName)) {
          const group = GROUPS.find((g) => g.name === groupName)!;
          results[groupName] = { loaded: true, tools: group.tools };
          continue;
        }

        const group = GROUPS.find((g) => g.name === groupName);
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

        const registered = registerGroupTools(server, bridge, group, readOnly);
        loadedGroups.add(groupName);
        results[groupName] = { loaded: true, tools: registered };
        anyLoaded = true;
      }

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
}
