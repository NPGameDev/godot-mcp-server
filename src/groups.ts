/**
 * Lazy-load tool groups — specialized workflows loaded on demand via
 * discover_tools. 23 groups, 57 group tools.
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
  coercedBoolean,
} from "./tool_helpers.js";
import { enrichGroupResults, enrichCoreMatches, type ToolMeta, type GroupResult } from "./tool_meta.js";
import { isEnabled, envVarFor } from "./feature_gate.js";
import { isAllowedInReadOnly, isExcludedByReadOnly } from "./profiles.js";
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
import { audioTools } from "./tools/audio.js";
import { spriteframesTools } from "./tools/spriteframes.js";
import { sceneQueryTools } from "./tools/scene_query.js";
import { particleTools } from "./tools/particles.js";
import { navigationTools } from "./tools/navigation.js";
import { lspAnalysisTools, lspNavigationTools, createLspHandler } from "./tools/lsp.js";
import { debugTools } from "./tools/debug.js";
import { classdbTools } from "./tools/classdb.js";

// ── Group definitions ────────────────────────────────────────────────

export type GroupName =
  | "runtime_advanced"
  | "signals"
  | "animation_authoring"
  | "input_map"
  | "resource_io"
  | "asset_ops"
  | "cleanup"
  | "user_data"
  | "scene_advanced"
  | "editor_advanced"
  | "tilemap"
  | "theme"
  | "layer_naming"
  | "path_editing"
  | "3d_tools"
  | "procedural"
  | "scene_inheritance"
  | "audio"
  | "spriteframes"
  | "particles"
  | "navigation"
  | "lsp_code_analysis"
  | "lsp_code_navigation"
  | "debugger"
  | "classdb";

const GROUP_NAMES: readonly GroupName[] = [
  "runtime_advanced",
  "signals",
  "animation_authoring",
  "input_map",
  "resource_io",
  "asset_ops",
  "cleanup",
  "user_data",
  "scene_advanced",
  "editor_advanced",
  "tilemap",
  "theme",
  "layer_naming",
  "path_editing",
  "3d_tools",
  "procedural",
  "scene_inheritance",
  "audio",
  "spriteframes",
  "particles",
  "navigation",
  "lsp_code_analysis",
  "lsp_code_navigation",
  "debugger",
  "classdb",
];

interface GroupDef {
  name: GroupName;
  description: string;
  tools: string[];
  keywords: string[];
  gate?: string; // Feature gate required to load this group
  gateEnvVar?: string;
}

export const GROUPS: GroupDef[] = [
  {
    name: "runtime_advanced",
    description: "Inspect live node state and control AnimationPlayer during playtests",
    tools: ["runtime_get_node_state", "animation_player_control"],
    keywords: [
      "runtime",
      "node state",
      "animation playback",
      "animationplayer",
      "play animation",
      "stop animation",
      "animation control",
      "inspect node",
    ],
  },
  {
    name: "signals",
    description: "Emit signals on scene nodes at editor-time or runtime",
    tools: ["signal_emit"],
    keywords: [
      "signal",
      "emit",
      "observer",
      "event",
      "handler",
      "callback",
    ],
  },
  {
    name: "animation_authoring",
    description: "Author keyframes, edit tracks, and configure AnimationTree state machines",
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
    description: "Create and edit input actions and their key/controller bindings",
    tools: ["input_map_action", "input_map_event"],
    keywords: [
      "input",
      "input map",
      "action",
      "key binding",
      "keybind",
      "keyboard",
      "controller",
      "gamepad",
      "joystick",
    ],
  },
  // FIX-3: asset_management (10 tools) split into 3 groups (2+2+6).
  {
    name: "resource_io",
    description: "Load and write Godot resources (.tres/.res) programmatically",
    tools: ["resource_load", "resource_write"],
    keywords: ["resource", "load", "write", "save resource", "tres", "res"],
  },
  {
    name: "asset_ops",
    description: "List assets, query dependencies, and import binary files into the project",
    tools: ["asset_list", "asset_get_dependencies", "asset_import"],
    keywords: ["asset", "import", "dependencies", "texture", "image", "list assets", "files", "browse"],
  },
  {
    name: "cleanup",
    description: "Delete files, scripts, scenes, resources, and folders; close open scenes",
    tools: ["file_delete", "scene_delete", "script_delete", "resource_delete", "folder_delete", "scene_close"],
    keywords: ["delete", "cleanup", "close", "remove", "delete file", "delete scene", "delete script"],
  },
  {
    name: "user_data",
    description: "Read, write, delete, and list user:// save files",
    tools: ["save_read", "save_write", "save_delete", "save_list"],
    keywords: ["save", "save file", "user data", "persistence", "save game", "load game", "savegame"],
    gate: "read_user_scope",
    gateEnvVar: "GODOT_MCP_ALLOW_USER_SCOPE",
  },
  {
    name: "scene_advanced",
    description: "Diff scenes and batch-instantiate nodes from packed scenes",
    tools: ["scene_diff", "scene_instantiate"],
    keywords: ["instantiate", "instance", "scene diff", "compare", "prefab", "spawn", "batch instantiate"],
  },
  {
    name: "editor_advanced",
    description: "Capture editor screenshots, refresh the filesystem, and wait for idle",
    tools: ["editor_screenshot", "editor_refresh", "editor_wait_for_idle"],
    keywords: [
      "screenshot",
      "editor screenshot",
      "refresh",
      "reload scripts",
      "rescan",
      "filesystem",
      "reimport",
      "wait idle",
      "editor capture",
    ],
  },
  {
    name: "tilemap",
    description: "Read and paint tilemap cells, create tilesets, and edit tileset properties",
    tools: ["tilemap_read_cells", "tilemap_set_cells", "tileset_create", "tileset_edit"],
    keywords: ["tilemap", "tileset", "tile", "grid", "terrain", "cell", "layer", "read cells"],
  },
  {
    name: "theme",
    description: "Edit UI theme overrides: styleboxes, fonts, colors, and constants",
    tools: ["theme_edit"],
    keywords: ["theme", "style", "stylebox", "font", "color", "ui style", "control theme"],
  },
  {
    name: "layer_naming",
    description: "Get and set physics, render, and navigation layer names",
    tools: ["layer_names_set", "layer_names_get"],
    keywords: ["layer", "layer name", "physics layer", "render layer", "collision layer", "collision mask", "mask"],
  },
  {
    name: "path_editing",
    description: "Edit Path2D curves and generate collision shapes from sprite textures",
    tools: ["path2d_edit_curve", "collision_from_texture"],
    keywords: [
      "path",
      "path2d",
      "curve",
      "bezier",
      "spline",
      "follow path",
      "pathfollow",
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
    description: "Create 3D primitives, lights, cameras, and environment setups",
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
    description: "Edit gradients, curves, and FastNoiseLite resources for procedural generation",
    tools: ["procedural_edit_gradient", "procedural_edit_curve", "procedural_edit_noise"],
    keywords: ["procedural", "generate", "gradient", "noise", "curve", "resource create", "fastnoiselite", "easing"],
  },
  {
    name: "scene_inheritance",
    description: "Create inherited scenes (variants) from base scenes",
    tools: ["scene_create_inherited"],
    keywords: ["inheritance", "inherited scene", "prefab", "variant", "base scene", "scene extend", "inherit"],
  },
  {
    name: "audio",
    description: "Configure audio buses, effects, and volume settings",
    tools: ["audiobus_edit"],
    keywords: ["audio", "audiobus", "sound", "music", "volume", "bus", "effect", "reverb", "sfx"],
  },
  {
    name: "spriteframes",
    description: "Create and edit SpriteFrames animations and import from spritesheets",
    tools: ["spriteframes_create", "spriteframes_edit", "spriteframes_from_spritesheet"],
    keywords: [
      "sprite",
      "spriteframes",
      "animated sprite",
      "frame",
      "flipbook",
      "2d animation",
      "spritesheet",
      "atlas",
    ],
  },
  {
    name: "particles",
    description: "Create and configure GPU particle systems for visual effects",
    tools: ["particles_create"],
    keywords: [
      "particle",
      "particles",
      "gpu particles",
      "vfx",
      "visual effect",
      "effects",
      "fire",
      "smoke",
      "sparks",
      "rain",
      "snow",
      "explosion",
      "emitter",
      "particle system",
    ],
  },
  {
    name: "navigation",
    description: "Set up navigation regions, meshes, and obstacle avoidance",
    tools: ["navigation_edit"],
    keywords: [
      "nav",
      "navigation",
      "navmesh",
      "pathfinding",
      "navigate",
      "obstacle",
      "avoidance",
      "navigation region",
      "nav polygon",
      "ai pathfinding",
    ],
  },
  {
    name: "lsp_code_analysis",
    description: "GDScript diagnostics, symbols, and hover info via the language server",
    tools: ["lsp_diagnostics", "lsp_symbols", "lsp_hover"],
    keywords: [
      "lsp",
      "diagnostics",
      "symbols",
      "hover",
      "type",
      "gdscript",
      "shader",
      "gdshader",
      "errors",
      "warnings",
      "validate",
      "analyze",
    ],
  },
  {
    name: "lsp_code_navigation",
    description: "Code completion, go-to-definition, and find references via the language server",
    tools: ["lsp_completion", "lsp_definition", "lsp_references"],
    keywords: [
      "completion",
      "definition",
      "references",
      "go to definition",
      "find references",
      "autocomplete",
      "navigate",
      "cross-file",
    ],
  },
  {
    name: "debugger",
    description: "Inspect debugger state, manage breakpoints, and control execution flow",
    tools: ["debug_state", "debug_list_breakpoints", "debug_set_breakpoint", "debug_continue"],
    keywords: ["debug", "breakpoint", "pause", "continue", "step", "debugger", "state", "breaked"],
  },
  {
    name: "classdb",
    description: "Inspect Godot class hierarchy — properties, methods, signals, inheritance",
    tools: ["classdb_get_info", "classdb_search"],
    keywords: ["class", "classdb", "api", "inheritance", "introspection"],
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
  audioTools,
  spriteframesTools,
  sceneQueryTools,
  particleTools,
  navigationTools,
  lspAnalysisTools,
  lspNavigationTools,
  debugTools,
  classdbTools,
]) {
  for (const t of tools) allDefs.set(t.name, t);
}

// Tools that route through the runtime (Mode B) bridge — only the 2
// remaining runtime_advanced group tools. The 4 promoted tools
// (runtime_screenshot, input_simulate, runtime_get_script_vars,
// debugger_get_log) are now standard and handled by runtime.ts.
const RUNTIME_TOOLS = new Set(["runtime_get_node_state", "animation_player_control"]);

// LSP tools — use their own TCP client, not the bridge.
const LSP_TOOLS = new Set([
  "lsp_diagnostics",
  "lsp_hover",
  "lsp_completion",
  "lsp_definition",
  "lsp_symbols",
  "lsp_references",
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
      if (LSP_TOOLS.has(def.name)) {
        const projectPath = process.env.GODOT_MCP_PROJECT_PATH ?? process.cwd();
        return createLspHandler(def.name, projectPath);
      }
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
    const def = allDefs.get(toolName);
    if (!def) continue;
    if (isExcludedByReadOnly(readOnly, def.annotations)) continue;
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
      { godotMinVersion: def.godotMinVersion, godotMaxVersion: def.godotMaxVersion },
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
  [
    "execute_code",
    ["eval", "evaluate", "execute", "runtime code", "expression", "execute code", "editor eval", "editor expression"],
  ],
  ["runtime_screenshot", ["screenshot", "capture", "viewport", "screen"]],
  ["input_simulate", ["input", "click", "key press", "mouse", "simulate"]],
  ["runtime_get_script_vars", ["variables", "script vars", "inspect runtime", "debug"]],
  ["runtime_set_property", ["runtime property", "set runtime", "live edit"]],
  ["debugger_get_log", ["debug", "debugger", "log", "breakpoint", "stack"]],
  ["node_call_method", ["call method", "invoke", "method", "function call"]],
  ["folder_create", ["folder", "directory", "mkdir", "create folder"]],
  ["signal_list", ["signals", "list signals", "node signals", "connections"]],
  ["signal_manage", ["connect signal", "disconnect signal", "signal wiring", "signal management"]],
  ["control_set_layout", ["layout", "anchor", "preset", "control layout", "anchors", "full rect"]],
  [
    "scene_query",
    ["query", "search", "find node", "filter", "class filter", "group filter", "node search", "scene query"],
  ],
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

function findMatchingGroups(
  rawRequest: string | string[],
  readOnly: boolean,
): {
  builtIn: GroupMatch[];
  extension: ExtGroupMatch[];
  core: CoreMatch[];
} {
  const queries = (Array.isArray(rawRequest) ? rawRequest : [rawRequest]).map((q) => q.toLowerCase());
  const builtIn: GroupMatch[] = [];
  const extension: ExtGroupMatch[] = [];
  const core: CoreMatch[] = [];

  for (const group of GROUPS) {
    // In read-only mode, skip groups with zero read-only tools.
    if (readOnly) {
      const hasReadOnlyTool = group.tools.some((t) => {
        const d = allDefs.get(t);
        return d ? isAllowedInReadOnly(d.annotations) : false;
      });
      if (!hasReadOnlyTool) continue;
    }
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
    // In read-only mode, skip extension groups with zero read-only tools.
    if (readOnly) {
      const hasReadOnly = ext.commands.some((c) => isAllowedInReadOnly(c.annotations));
      if (!hasReadOnly) continue;
    }
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
    // In read-only mode, only surface read-only core tools.
    if (readOnly) {
      const def = allDefs.get(toolName);
      if (!def || !isAllowedInReadOnly(def.annotations)) continue;
    }
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
function buildDiscoverToolsDesc(readOnly: boolean): string {
  const parts: string[] = [];
  for (const group of GROUPS) {
    // In read-only mode, filter to read-only tools and omit empty groups.
    const tools = readOnly
      ? group.tools.filter((t) => {
          const d = allDefs.get(t);
          return d ? isAllowedInReadOnly(d.annotations) : false;
        })
      : group.tools;
    if (readOnly && tools.length === 0) continue;

    const loaded = loadedGroups.has(group.name);
    const gateBlocked = !!(group.gate && !isEnabled(group.gate));
    let state: string;
    if (loaded) state = "LOADED";
    else if (gateBlocked) state = "GATED";
    else state = "available";

    let entry = `${group.name} [${state}] "${group.description}" (${tools.join(", ")}`;
    if (group.gateEnvVar && gateBlocked) entry += ` — requires: ${group.gateEnvVar}=1`;
    entry += ")";
    parts.push(entry);
  }

  const extParts: string[] = [];
  for (const [name, ext] of extensionGroups) {
    // In read-only mode, filter to read-only extension tools and omit empty groups.
    const cmds = readOnly ? ext.commands.filter((c) => isAllowedInReadOnly(c.annotations)) : ext.commands;
    if (readOnly && cmds.length === 0) continue;
    const loaded = loadedExtensionGroups.has(name);
    const tools = cmds.map((c) => c.toolName).join(", ");
    const desc = ext.description || name;
    extParts.push(`${name} [${loaded ? "LOADED" : "available"}] "${desc}" → ${tools}`);
  }

  let description =
    "Search and activate tool groups by keyword or name. " +
    "Pass request to search by domain ('animation', 'save game data') or groups to activate by name. " +
    "Activate only the groups needed for your current task (up to ~5) — loading many groups at once floods the tool list and degrades response quality. " +
    "No params → full catalog. reset: true → deactivate ALL groups; reset: ['group_a'] → deactivate only group_a. " +
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
        const def = allDefs.get(toolName);
        if (isExcludedByReadOnly(readOnly, def?.annotations)) continue;
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
    updateToolRef("discover_tools", { description: buildDiscoverToolsDesc(readOnly) });
    return;
  }
  registerToolWrapped(
    server,
    bridge,
    "discover_tools",
    {
      description: buildDiscoverToolsDesc(readOnly),
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
        include_schemas: coercedBoolean()
          .optional()
          .describe(
            "Include full parameter schemas and annotations for activated tools. " +
              "Default false. Set true when activated tools require a separate " +
              "tool lookup to obtain schemas.",
          ),
        reset: z
          .union([z.literal(true), z.array(z.string())])
          .optional()
          .describe(
            "Deactivate groups. true = reset ALL on-demand groups. " +
              'Array of group names = selectively deactivate only those groups (e.g. reset: ["tilemap", "audio"]). ' +
              "Other loaded groups remain active.",
          ),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input: Record<string, unknown>) => {
      const parsed = input as {
        request?: string | string[];
        groups?: string[];
        activate?: boolean;
        include_schemas?: boolean;
        reset?: true | string[];
      };
      const activate = parsed.activate !== false;
      const includeSchemas = parsed.include_schemas === true;

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
          const matches = findMatchingGroups(parsed.request, readOnly);
          for (const m of matches.builtIn) {
            if (groupResults.some((r) => r.name === m.group.name)) continue;
            groupResults.push(activateOrReportGroup(server, bridge, m.group.name, activate, readOnly));
          }
          for (const m of matches.extension) {
            if (groupResults.some((r) => r.name === m.name)) continue;
            groupResults.push(activateOrReportExtGroup(server, bridge, m.name, activate, readOnly));
          }
        }

        // Update discover_tools description inside the batch so the
        // tools/list_changed notification fires atomically with all
        // registrations.  Previously this lived outside batchToolRegistration,
        // causing a split notification that left Claude Code's tool index
        // stale after groups: activation (FIX-C).
        updateToolRef("discover_tools", { description: buildDiscoverToolsDesc(readOnly) });
      });

      // No params → full catalog (no activation).
      if (parsed.request === undefined && !parsed.groups && parsed.reset === undefined) {
        for (const group of GROUPS) {
          groupResults.push(reportGroupStatus(group.name, readOnly));
        }
        for (const [name] of extensionGroups) {
          groupResults.push(reportExtGroupStatus(name));
        }
      }

      // Post-collection enrichment: replace bare {name} tool objects with
      // full metadata for activated/already_loaded groups.
      const extCmdLookup = new Map<string, ExtensionCmd>();
      for (const [, ext] of extensionGroups) {
        for (const cmd of ext.commands) extCmdLookup.set(cmd.toolName, cmd);
      }
      enrichGroupResults(groupResults, includeSchemas, allDefs, extCmdLookup);

      // Build response.
      const response: Record<string, unknown> = { success: true, groups: groupResults };

      // Core matches — only when request was given.
      if (parsed.request !== undefined) {
        const { core } = findMatchingGroups(parsed.request, readOnly);
        if (core.length > 0) response.core_matches = enrichCoreMatches(core, includeSchemas, allDefs);
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

      // Warn when too many groups are activated at once — context flood degrades agent quality.
      const justActivated = groupResults.filter((r) => r.status === "activated");
      if (justActivated.length > 5) {
        response.warning =
          `${justActivated.length} groups activated at once. ` +
          "This adds many tools to your context and may degrade response quality. " +
          "Prefer activating only the groups needed for your current task. " +
          "Use reset to deactivate groups you no longer need.";
      }

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
): GroupResult {
  const group = GROUPS.find((g) => g.name === groupName);
  if (!group) {
    // Try extension groups.
    return activateOrReportExtGroup(server, bridge, groupName, activate, readOnly);
  }

  // In read-only mode, filter tool lists to only show read-only tools.
  const toolNames = readOnly
    ? group.tools.filter((t) => {
        const d = allDefs.get(t);
        return d ? isAllowedInReadOnly(d.annotations) : false;
      })
    : group.tools;
  const tools: ToolMeta[] = toolNames.map((t) => ({ name: t }));

  if (loadedGroups.has(groupName)) {
    return { name: groupName, status: "already_loaded", tools, description: group.description };
  }
  if (group.gate && !isEnabled(group.gate)) {
    return {
      name: groupName,
      status: "gated",
      tools,
      description: group.description,
      gate: group.gateEnvVar ?? envVarFor(group.gate) ?? group.gate,
    };
  }
  if (!activate) {
    return { name: groupName, status: "available", tools, description: group.description };
  }
  const registered = registerGroupTools(server, bridge, group, readOnly);
  // In read-only mode, if all tools were filtered out, don't waste a group slot.
  if (readOnly && registered.length === 0) {
    return {
      name: groupName,
      status: "available",
      tools: [],
      description: `Group '${groupName}' has no tools available in read-only mode.`,
    };
  }
  loadedGroups.add(groupName);
  return {
    name: groupName,
    status: "activated",
    tools: registered.map((t) => ({ name: t })),
    description: group.description,
  };
}

function activateOrReportExtGroup(
  server: McpServer,
  bridge: Bridge,
  name: string,
  activate: boolean,
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
  if (!activate) {
    return { name, status: "available", tools, description: ext.description };
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

function reportGroupStatus(groupName: string, readOnly: boolean): GroupResult {
  const group = GROUPS.find((g) => g.name === groupName);
  if (!group) return { name: groupName, status: "available", tools: [] };
  // In read-only mode, filter tool lists to only show read-only tools.
  const toolNames = readOnly
    ? group.tools.filter((t) => {
        const d = allDefs.get(t);
        return d ? isAllowedInReadOnly(d.annotations) : false;
      })
    : group.tools;
  const tools: ToolMeta[] = toolNames.map((t) => ({ name: t }));
  if (loadedGroups.has(groupName))
    return { name: groupName, status: "already_loaded", tools, description: group.description };
  if (group.gate && !isEnabled(group.gate)) {
    return {
      name: groupName,
      status: "gated",
      tools,
      description: group.description,
      gate: group.gateEnvVar ?? envVarFor(group.gate) ?? group.gate,
    };
  }
  return { name: groupName, status: "available", tools, description: group.description };
}

function reportExtGroupStatus(name: string): GroupResult {
  const ext = extensionGroups.get(name);
  if (!ext) return { name, status: "available", tools: [] };
  const tools: ToolMeta[] = ext.commands.map((c) => ({ name: c.toolName }));
  if (loadedExtensionGroups.has(name)) return { name, status: "already_loaded", tools, description: ext.description };
  return { name, status: "available", tools, description: ext.description };
}

/** Register an extension group's tools (called from discover_tools handler). */
function registerExtGroupTools(
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

/**
 * For power_user profile: register all extension group tools immediately.
 * Batches notifications so only 1 tools/list_changed fires regardless of tool count.
 */
export function registerAllExtensionGroupTools(server: McpServer, bridge: Bridge, readOnly: boolean = false): void {
  batchToolRegistration(server, () => {
    for (const [name, group] of extensionGroups) {
      if (loadedExtensionGroups.has(name)) continue;
      registerExtGroupTools(server, bridge, group, readOnly);
      loadedExtensionGroups.add(name);
    }
  });
}
