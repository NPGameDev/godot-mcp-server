/**
 * Lazy-load tool groups — specialized workflows loaded on demand via
 * discover_tools. 10 groups, 34 tools total. Standard profile
 * registers discover_tools as the meta-tool; power_user profile
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
import { isEnabled, envVarFor } from "./feature_gate.js";
import { MUTATING_TOOLS } from "./profiles.js";
import { removeToolByName, updateToolRef, hasToolRef } from "./tool_refs.js";

// Import tool defs from all modules that contribute group tools.
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
import { scriptTools } from "./tools/script.js";
import { folderTools } from "./tools/folder.js";
import { diffTools } from "./tools/diff.js";
import { tilemapTools } from "./tools/tilemap.js";
import { themeTools } from "./tools/theme.js";
import { nodeManagementTools } from "./tools/node_management.js";
import { layerNameTools } from "./tools/layer_names.js";
import { pathTools } from "./tools/path.js";
import { collisionTools } from "./tools/collision.js";
import { threeDTools } from "./tools/three_d.js";
import { proceduralTools } from "./tools/procedural.js";
import { sceneInheritanceTools } from "./tools/scene_inheritance.js";

// ── Group definitions ────────────────────────────────────────────────

export type GroupName =
  | "runtime_advanced"
  | "signals"
  | "animation_authoring"
  | "input_map"
  | "asset_management"
  | "user_data"
  | "scene_advanced"
  | "editor_advanced"
  | "tilemap"
  | "theme"
  | "node_management"
  | "layer_naming"
  | "path_editing"
  | "3d_tools"
  | "procedural"
  | "scene_inheritance";

const GROUP_NAMES: readonly GroupName[] = [
  "runtime_advanced",
  "signals",
  "animation_authoring",
  "input_map",
  "asset_management",
  "user_data",
  "scene_advanced",
  "editor_advanced",
  "tilemap",
  "theme",
  "node_management",
  "layer_naming",
  "path_editing",
  "3d_tools",
  "procedural",
  "scene_inheritance",
];

interface GroupDef {
  name: GroupName;
  tools: string[];
  keywords: string[];
  gate?: string; // Feature gate required to load this group
  gateEnvVar?: string;
}

export const GROUPS: GroupDef[] = [
  {
    name: "runtime_advanced",
    tools: ["runtime_get_node_state", "animation_player_control"],
    keywords: ["runtime", "node state", "animation playback", "animationplayer", "play animation", "stop animation"],
  },
  {
    name: "signals",
    tools: ["signal_list", "signal_manage", "signal_emit"],
    keywords: [
      "signal",
      "connect",
      "disconnect",
      "emit",
      "observer",
      "event",
      "editor signal",
      "persisted connection",
      "scene signal",
    ],
  },
  {
    name: "animation_authoring",
    tools: ["animation_keyframe", "animation_get_keys", "animationtree_edit"],
    keywords: [
      "animation",
      "keyframe",
      "track",
      "animate",
      "animationtree",
      "state machine",
      "blend tree",
      "transition",
      "blend",
    ],
  },
  {
    name: "input_map",
    tools: ["input_map_action", "input_map_event"],
    keywords: ["input", "input map", "action", "key binding", "keybind", "controller", "gamepad", "joystick"],
  },
  {
    name: "asset_management",
    tools: [
      "asset_get_dependencies",
      "asset_import",
      "resource_delete",
      "file_delete",
      "scene_delete",
      "scene_close",
      "resource_load",
      "resource_write",
      "script_delete",
      "folder_delete",
    ],
    keywords: [
      "asset",
      "import",
      "resource",
      "delete file",
      "delete scene",
      "delete script",
      "cleanup",
      "dependencies",
    ],
  },
  {
    name: "user_data",
    tools: ["save_read", "save_write", "save_delete", "save_list"],
    keywords: ["save", "save file", "user data", "persistence", "save game", "load game", "savegame"],
    gate: "read_user_scope",
    gateEnvVar: "GODOT_MCP_ALLOW_USER_SCOPE",
  },
  {
    name: "scene_advanced",
    tools: ["scene_diff", "scene_instantiate"],
    keywords: ["instantiate", "instance", "scene diff", "compare", "prefab", "spawn", "batch instantiate"],
  },
  {
    name: "editor_advanced",
    tools: ["editor_screenshot", "editor_reload_scripts", "editor_wait_for_idle"],
    keywords: ["screenshot", "editor screenshot", "reload scripts", "wait idle", "editor capture"],
  },
  {
    name: "tilemap",
    tools: ["tilemap_set_cells", "tileset_create", "tileset_edit"],
    keywords: ["tilemap", "tileset", "tile", "grid", "terrain", "cell", "layer"],
  },
  {
    name: "theme",
    tools: ["theme_edit"],
    keywords: ["theme", "style", "stylebox", "font", "color", "ui style", "control theme"],
  },
  {
    name: "node_management",
    tools: ["node_manage", "node_groups", "autoload_manage"],
    keywords: [
      "node",
      "rename",
      "reparent",
      "reorder",
      "duplicate",
      "clone",
      "copy node",
      "move node",
      "group",
      "node group",
      "autoload",
      "singleton",
      "batch",
    ],
  },
  {
    name: "layer_naming",
    tools: ["layer_names_set", "layer_names_get"],
    keywords: ["layer", "layer name", "physics layer", "render layer", "collision layer", "mask"],
  },
  {
    name: "path_editing",
    tools: ["path2d_edit_curve", "collision_from_texture"],
    keywords: [
      "path",
      "path2d",
      "curve",
      "bezier",
      "spline",
      "follow path",
      "curve2d",
      "collision",
      "collision polygon",
      "sprite",
      "bitmap",
      "alpha",
      "shape from texture",
    ],
  },
  {
    name: "3d_tools",
    tools: ["3d_create_primitive", "3d_setup_environment", "3d_create_light", "3d_create_camera"],
    keywords: [
      "3d",
      "mesh",
      "meshinstance",
      "primitive",
      "camera3d",
      "light",
      "environment",
      "directional light",
      "world environment",
      "sky",
    ],
  },
  {
    name: "procedural",
    tools: ["procedural_edit_gradient", "procedural_edit_curve", "procedural_edit_noise"],
    keywords: ["procedural", "generate", "gradient", "noise", "curve", "resource create", "fastnoiselite", "easing"],
  },
  {
    name: "scene_inheritance",
    tools: ["scene_create_inherited"],
    keywords: ["inheritance", "inherited scene", "prefab", "variant", "base scene", "scene extend", "inherit"],
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
  scriptTools,
  folderTools,
  diffTools,
  tilemapTools,
  themeTools,
  nodeManagementTools,
  layerNameTools,
  pathTools,
  collisionTools,
  threeDTools,
  proceduralTools,
  sceneInheritanceTools,
]) {
  for (const t of tools) allDefs.set(t.name, t);
}

// Tools that route through the runtime (Mode B) bridge — only the 2
// remaining runtime_advanced group tools. The 4 promoted tools
// (runtime_screenshot, input_simulate, runtime_get_script_vars,
// debugger_get_log) are now standard and handled by runtime.ts.
const RUNTIME_TOOLS = new Set(["runtime_get_node_state", "animation_player_control"]);

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
  keywords: string[];
  commands: ExtensionCmd[];
}

const extensionGroups = new Map<string, ExtensionGroupDef>();
const loadedExtensionGroups = new Set<string>();

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

/** editor_screenshot returns multi-content (image + text metadata). */
function handleEditorScreenshot(bridge: Bridge, def: ToolDef) {
  return async (input: unknown) => {
    try {
      const result = await bridge.call(def.method, input ?? {});
      const err = toolErrorFromPayload(result);
      if (err) return err;
      const obj = result as {
        image_base64?: string;
        mime_type?: string;
        width?: number;
        height?: number;
        bytes?: number;
        path?: string;
      };
      if (!obj?.image_base64) {
        return toolErrorFromPayload({
          success: false,
          code: "EMPTY_CONTENT",
          error:
            "screenshot returned no image bytes — node may lack visual content. Use editor_screenshot for full viewport.",
        })!;
      }
      return {
        content: [
          { type: "image" as const, data: obj.image_base64, mimeType: obj.mime_type ?? "image/png" },
          {
            type: "text" as const,
            text: JSON.stringify({
              width: obj.width,
              height: obj.height,
              bytes: obj.bytes,
              path: obj.path,
            }),
          },
        ],
      };
    } catch (err) {
      return toolErrorFromException(err);
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
    case "editor_screenshot":
      return handleEditorScreenshot(bridge, def);
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

// ── Core tool keywords (Standard profile tools) ─────────────────────
// Maps standard-profile tool names to keyword arrays for discover_tools
// core_matches. Kept here (not in types.ts) to avoid touching every tool file.

const CORE_TOOL_KEYWORDS = new Map<string, string[]>([
  ["scene_get_tree", ["scene", "tree", "hierarchy", "nodes", "scene tree"]],
  ["scene_create_node", ["create node", "add node", "new node", "scene"]],
  ["scene_delete_node", ["delete node", "remove node", "scene"]],
  ["scene_create", ["new scene", "create scene", "packed scene"]],
  ["scene_open", ["open scene", "load scene", "switch scene"]],
  ["node_get_property", ["property", "get property", "inspect", "node"]],
  ["node_set_property", ["set property", "change property", "modify", "node"]],
  ["node_get_property_list", ["property list", "properties", "inspect", "node"]],
  ["node_set_script", ["attach script", "set script", "node", "gdscript"]],
  ["script_read", ["read script", "view script", "gdscript", "source"]],
  ["script_write", ["write script", "create script", "edit script", "gdscript"]],
  ["script_check", ["check script", "validate", "syntax", "diagnostics", "lint"]],
  ["editor_save_scene", ["save", "save scene", "persist"]],
  ["editor_get_console", ["console", "output", "log", "errors", "warnings"]],
  ["project_get_settings", ["project settings", "config", "configuration"]],
  ["project_set_setting", ["set setting", "change setting", "project config"]],
  ["game_start", ["run", "play", "start game", "launch", "playtest"]],
  ["game_stop", ["stop", "quit", "stop game", "end playtest"]],
  ["game_eval", ["eval", "evaluate", "execute", "runtime code", "expression"]],
  ["runtime_screenshot", ["screenshot", "capture", "viewport", "screen"]],
  ["input_simulate", ["input", "click", "key press", "mouse", "simulate"]],
  ["runtime_get_script_vars", ["variables", "script vars", "inspect runtime", "debug"]],
  ["runtime_set_property", ["runtime property", "set runtime", "live edit"]],
  ["debugger_get_log", ["debug", "debugger", "log", "breakpoint", "stack"]],
  ["node_call_method", ["call method", "invoke", "method", "function call"]],
  ["folder_create", ["folder", "directory", "mkdir", "create folder"]],
  ["asset_list", ["list assets", "files", "browse", "directory listing"]],
  ["classdb_get_info", ["class", "classdb", "class info", "properties", "methods", "signals", "inheritance"]],
  ["classdb_search", ["search class", "find class", "class lookup", "api"]],
  ["extensions_refresh", ["extensions", "refresh", "reload extensions", "plugins"]],
]);

// ── Keyword matching ────────────────────────────────────────────────

type GroupMatch = { group: GroupDef; score: number };
type ExtGroupMatch = { name: string; ext: ExtensionGroupDef; score: number };
type CoreMatch = { name: string; description: string };

function matchKeywords(query: string, keywords: string[]): number {
  let score = 0;
  for (const kw of keywords) {
    if (query === kw) score += 3;
    else if (query.includes(kw)) score += 2;
    else if (kw.includes(query) && query.length >= 3) score += 1;
  }
  return score;
}

function findMatchingGroups(rawRequest: string | string[]): {
  builtIn: GroupMatch[];
  extension: ExtGroupMatch[];
  core: CoreMatch[];
} {
  const queries = (Array.isArray(rawRequest) ? rawRequest : [rawRequest]).map((q) => q.toLowerCase());
  const builtIn: GroupMatch[] = [];
  const extension: ExtGroupMatch[] = [];
  const core: CoreMatch[] = [];

  for (const group of GROUPS) {
    let score = 0;
    for (const q of queries) {
      score += matchKeywords(q, group.keywords);
      // Also match against tool names (underscores → spaces).
      for (const toolName of group.tools) {
        const norm = toolName.replace(/_/g, " ");
        if (norm.includes(q) && q.length >= 3) score += 1;
      }
    }
    if (score > 0) builtIn.push({ group, score });
  }
  builtIn.sort((a, b) => b.score - a.score);

  for (const [name, ext] of extensionGroups) {
    let score = 0;
    for (const q of queries) {
      // Extension keywords (author-provided) — same scoring as built-in groups.
      if (ext.keywords.length > 0) {
        score += matchKeywords(q, ext.keywords);
      }
      // Fallback: match against description tokens + tool names.
      const descTokens = (ext.description || name).toLowerCase().split(/\s+/);
      for (const tok of descTokens) {
        if (q === tok) score += 2;
        else if (tok.includes(q) && q.length >= 3) score += 1;
      }
      for (const cmd of ext.commands) {
        const norm = cmd.toolName.replace(/_/g, " ");
        if (norm.includes(q) && q.length >= 3) score += 1;
      }
    }
    if (score > 0) extension.push({ name, ext, score });
  }
  extension.sort((a, b) => b.score - a.score);

  // Core tool matching — surface already-available tools that match.
  const seen = new Set<string>();
  for (const [toolName, keywords] of CORE_TOOL_KEYWORDS) {
    for (const q of queries) {
      if (matchKeywords(q, keywords) > 0 && !seen.has(toolName)) {
        const def = allDefs.get(toolName);
        if (def) {
          core.push({ name: toolName, description: def.description.slice(0, 120) });
          seen.add(toolName);
        }
      }
    }
  }

  return { builtIn, extension, core };
}

// ── discover_tools description builder ──────────────────────────────

// I2 waiver: discover_tools description intentionally exceeds the 200-char
// tool-description limit. As the gateway to 30+ hidden tools, discoverability
// is more important than description brevity for this meta-tool.
function buildDiscoverToolsDesc(): string {
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

  const extParts: string[] = [];
  for (const [name, ext] of extensionGroups) {
    const loaded = loadedExtensionGroups.has(name);
    const tools = ext.commands.map((c) => c.toolName).join(", ");
    const desc = ext.description || name;
    extParts.push(`${name} [${loaded ? "LOADED" : "available"}] "${desc}" → ${tools}`);
  }

  let description =
    "Search and activate tool groups by keyword or name. " +
    "Pass request to search by domain ('animation', 'save game data') or groups to activate by name. " +
    "No params → full catalog. reset: true → deactivate all groups. " +
    "Groups: " +
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
  if (extNames.length === 0) return `Group names to activate: ${builtIn}`;
  return `Group names to activate: ${builtIn}, ${extNames.join(", ")}`;
}

// ── Group deactivation ──────────────────────────────────────────────

function deactivateGroups(names: string[] | true, readOnly: boolean): string[] {
  const deactivated: string[] = [];
  const targets = names === true ? [...loadedGroups, ...loadedExtensionGroups] : names;

  for (const groupName of targets) {
    // Built-in group?
    const group = GROUPS.find((g) => g.name === groupName);
    if (group && loadedGroups.has(groupName)) {
      for (const toolName of group.tools) {
        if (readOnly && MUTATING_TOOLS.has(toolName)) continue;
        removeToolByName(toolName);
      }
      loadedGroups.delete(groupName);
      deactivated.push(groupName);
      continue;
    }
    // Extension group?
    if (loadedExtensionGroups.has(groupName)) {
      const ext = extensionGroups.get(groupName);
      if (ext) {
        for (const cmd of ext.commands) removeToolByName(cmd.toolName);
      }
      loadedExtensionGroups.delete(groupName);
      deactivated.push(groupName);
    }
  }
  return deactivated;
}

/**
 * Register the discover_tools meta-tool and its handler.
 * Call this for the standard profile only. Idempotent — if the tool
 * already exists, updates its description in-place (one notification);
 * otherwise registers fresh (also one notification).
 */
export function registerGroupSystem(server: McpServer, bridge: Bridge, readOnly: boolean): void {
  if (hasToolRef("discover_tools")) {
    updateToolRef("discover_tools", { description: buildDiscoverToolsDesc() });
    return;
  }
  registerToolWrapped(
    server,
    bridge,
    "discover_tools",
    {
      description: buildDiscoverToolsDesc(),
      inputSchema: {
        request: z
          .union([z.string(), z.array(z.string())])
          .optional()
          .describe(
            "Search by keyword — a domain, task, or Godot concept. " +
              "String for single ('animation') or array for multiple (['animation', 'tilemap']). " +
              "Matching groups are auto-activated (set activate=false to browse).",
          ),
        groups: z.array(z.string()).optional().describe(buildGroupsDescribe()),
        activate: z
          .boolean()
          .optional()
          .describe("Auto-activate matching groups. Default true. Set false to browse without loading."),
        reset: z
          .union([z.literal(true), z.array(z.string())])
          .optional()
          .describe(
            "Deactivate groups. true = reset ALL on-demand groups. Array = selectively deactivate named groups.",
          ),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input: Record<string, unknown>) => {
      const parsed = input as {
        request?: string | string[];
        groups?: string[];
        activate?: boolean;
        reset?: true | string[];
      };
      const activate = parsed.activate !== false;

      type GroupResult = {
        name: string;
        status: "activated" | "available" | "already_loaded" | "gated";
        tools: string[];
        description?: string;
        gate?: string;
      };
      const groupResults: GroupResult[] = [];
      const deactivated: string[] = [];

      batchToolRegistration(server, () => {
        // Phase 1: reset/deactivation.
        if (parsed.reset !== undefined) {
          const names = parsed.reset === true ? true : parsed.reset;
          deactivated.push(...deactivateGroups(names, readOnly));
        }

        // Phase 2: direct group activation.
        if (parsed.groups) {
          for (const groupName of parsed.groups) {
            groupResults.push(activateOrReportGroup(server, bridge, groupName, activate, readOnly));
          }
        }

        // Phase 3: keyword search.
        if (parsed.request !== undefined) {
          const matches = findMatchingGroups(parsed.request);
          for (const m of matches.builtIn) {
            if (groupResults.some((r) => r.name === m.group.name)) continue;
            groupResults.push(activateOrReportGroup(server, bridge, m.group.name, activate, readOnly));
          }
          for (const m of matches.extension) {
            if (groupResults.some((r) => r.name === m.name)) continue;
            groupResults.push(activateOrReportExtGroup(server, bridge, m.name, activate));
          }
        }
      });

      // No params → full catalog (no activation).
      if (parsed.request === undefined && !parsed.groups && parsed.reset === undefined) {
        for (const group of GROUPS) {
          groupResults.push(reportGroupStatus(group.name));
        }
        for (const [name] of extensionGroups) {
          groupResults.push(reportExtGroupStatus(name));
        }
      }

      // Build response.
      const response: Record<string, unknown> = { success: true, groups: groupResults };

      // Core matches — only when request was given.
      if (parsed.request !== undefined) {
        const { core } = findMatchingGroups(parsed.request);
        if (core.length > 0) response.core_matches = core;
      }
      if (deactivated.length > 0) {
        response.deactivated = deactivated;
        // List individual tool names so the agent knows exactly what's gone.
        const deactivatedTools: string[] = [];
        for (const gName of deactivated) {
          const group = GROUPS.find((g) => g.name === gName);
          if (group) deactivatedTools.push(...group.tools);
          const ext = extensionGroups.get(gName);
          if (ext) deactivatedTools.push(...ext.commands.map((c) => c.toolName));
        }
        if (deactivatedTools.length > 0) response.deactivated_tools = deactivatedTools;
        response.hint =
          "Deactivated tools are no longer callable. " +
          "Call discover_tools(groups=[...]) to re-activate before using them.";
      }

      // Update discover_tools description to reflect new state.
      updateToolRef("discover_tools", { description: buildDiscoverToolsDesc() });

      return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
    },
  );
}

/** Activate a built-in or extension group by name, or report status if not activating. */
function activateOrReportGroup(
  server: McpServer,
  bridge: Bridge,
  groupName: string,
  activate: boolean,
  readOnly: boolean,
): {
  name: string;
  status: "activated" | "available" | "already_loaded" | "gated";
  tools: string[];
  description?: string;
  gate?: string;
} {
  const group = GROUPS.find((g) => g.name === groupName);
  if (!group) {
    // Try extension groups.
    return activateOrReportExtGroup(server, bridge, groupName, activate);
  }

  if (loadedGroups.has(groupName)) {
    return { name: groupName, status: "already_loaded", tools: group.tools };
  }
  if (group.gate && !isEnabled(group.gate)) {
    return {
      name: groupName,
      status: "gated",
      tools: group.tools,
      gate: group.gateEnvVar ?? envVarFor(group.gate) ?? group.gate,
    };
  }
  if (!activate) {
    return { name: groupName, status: "available", tools: group.tools };
  }
  const registered = registerGroupTools(server, bridge, group, readOnly);
  loadedGroups.add(groupName);
  return { name: groupName, status: "activated", tools: registered };
}

function activateOrReportExtGroup(
  server: McpServer,
  bridge: Bridge,
  name: string,
  activate: boolean,
): {
  name: string;
  status: "activated" | "available" | "already_loaded" | "gated";
  tools: string[];
  description?: string;
} {
  const ext = extensionGroups.get(name);
  if (!ext) {
    return { name, status: "available", tools: [], description: `Unknown group: ${name}` };
  }
  const tools = ext.commands.map((c) => c.toolName);
  if (loadedExtensionGroups.has(name)) {
    return { name, status: "already_loaded", tools, description: ext.description };
  }
  if (!activate) {
    return { name, status: "available", tools, description: ext.description };
  }
  const registered = registerExtGroupTools(server, bridge, ext);
  loadedExtensionGroups.add(name);
  return { name, status: "activated", tools: registered, description: ext.description };
}

function reportGroupStatus(groupName: string): {
  name: string;
  status: "activated" | "available" | "already_loaded" | "gated";
  tools: string[];
  gate?: string;
} {
  const group = GROUPS.find((g) => g.name === groupName);
  if (!group) return { name: groupName, status: "available", tools: [] };
  if (loadedGroups.has(groupName)) return { name: groupName, status: "already_loaded", tools: group.tools };
  if (group.gate && !isEnabled(group.gate)) {
    return {
      name: groupName,
      status: "gated",
      tools: group.tools,
      gate: group.gateEnvVar ?? envVarFor(group.gate) ?? group.gate,
    };
  }
  return { name: groupName, status: "available", tools: group.tools };
}

function reportExtGroupStatus(name: string): {
  name: string;
  status: "activated" | "available" | "already_loaded" | "gated";
  tools: string[];
  description?: string;
} {
  const ext = extensionGroups.get(name);
  if (!ext) return { name, status: "available", tools: [] };
  const tools = ext.commands.map((c) => c.toolName);
  if (loadedExtensionGroups.has(name)) return { name, status: "already_loaded", tools, description: ext.description };
  return { name, status: "available", tools, description: ext.description };
}

/** Register an extension group's tools (called from discover_tools handler). */
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
 * No discover_tools needed.
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
