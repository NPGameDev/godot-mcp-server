/**
 * Static group catalogue — the GROUPS literal (which group owns which tools +
 * keywords) and its derived index/lookup sets: the allDefs name→ToolDef map,
 * the GROUP_TOOL_NAMES membership set, and the RUNTIME_TOOLS / LSP_TOOLS
 * routing sets. Pure-data leaf — imports the canonical ALL_TOOL_DEFS
 * (catalogue.ts) and nothing else group-internal, so tool-def modules never
 * cycle back here via catalogue.ts. Extracted from groups.ts (concern 077, C0).
 */
import type { ToolDef } from "./types.js";
import type { GroupDef, GroupName } from "./group_types.js";

// Canonical tool inventory (single source of truth for counting + lookup).
// A leaf module that does NOT import groups.ts, so tool-def modules never
// cycle back here via catalogue.ts.
import { ALL_TOOL_DEFS } from "./catalogue.js";

// Re-export the group type vocabulary so group_catalogue.ts's public surface
// stays byte-stable: group_activation.ts imports GroupDef from here, and the
// groups.ts barrel re-exports GroupName from here. The declarations themselves
// now live in the pure-types leaf group_types.ts (concern 094, C0).
export type { GroupDef, GroupName } from "./group_types.js";

// ── Group definitions ────────────────────────────────────────────────

export const GROUP_NAMES: readonly GroupName[] = [
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
  "tileset",
  "tileset_edit",
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
  "placeholders",
];

export const GROUPS: GroupDef[] = [
  {
    name: "runtime_advanced",
    description: "Inspect live node state, set node properties, and control AnimationPlayer during playtests",
    tools: ["runtime_get_node_state", "runtime_set_property", "animation_player_control"],
    keywords: [
      "runtime",
      "node state",
      "set property",
      "runtime property",
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
    keywords: ["signal", "emit", "observer", "event", "handler", "callback"],
  },
  {
    name: "animation_authoring",
    description: "Inspect and author keyframes, edit tracks, and configure AnimationTree state machines",
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
    description: "List, create, and edit input actions and their key/controller bindings",
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
    name: "placeholders",
    description:
      "Generate placeholder/prototype assets procedurally — textures (shapes, patterns, labels) and sound effects (tones, noise). No art or network needed.",
    tools: ["texture_generate", "sound_generate"],
    keywords: [
      "placeholder",
      "prototype",
      "prototyping",
      "stand-in",
      "mock",
      "generate",
      "procedural",
      "texture",
      "sprite",
      "image",
      "icon",
      "png",
      "sound",
      "sfx",
      "audio",
      "tone",
      "beep",
      "noise",
      "wav",
      "art",
      "asset",
    ],
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
    description: "Read and paint cells on TileMap/TileMapLayer nodes — cell queries, bulk fills, and region operations",
    tools: ["tilemap_read_cells", "tilemap_set_cells"],
    keywords: ["tilemap", "tile", "grid", "cell", "read cells", "paint cells", "2d"],
  },
  {
    name: "tileset",
    description: "Create TileSet resources, add atlas sources, configure layers, and manage tile alternatives",
    tools: [
      "tileset_create",
      "tileset_add_source",
      "tileset_remove_source",
      "tileset_add_alternative",
      "tileset_remove_alternative",
      "tileset_setup_layers",
    ],
    keywords: [
      "tileset",
      "atlas",
      "tile source",
      "tile layer",
      "terrain set",
      "tile alternative",
      "tile variant",
      "create tileset",
    ],
  },
  {
    name: "tileset_edit",
    description: "Edit per-tile properties: physics, terrain, navigation, visuals, and custom data",
    tools: [
      "tileset_edit_physics",
      "tileset_edit_terrain",
      "tileset_edit_navigation",
      "tileset_edit_visuals",
      "tileset_edit_custom_data",
    ],
    keywords: [
      "tileset collision",
      "tile physics",
      "tile terrain",
      "tile navigation",
      "tile occlusion",
      "tile animation",
      "tile custom data",
      "peering bits",
    ],
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
      "2d",
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
    description: "List and configure audio buses, effects, and volume settings",
    tools: ["audiobus_edit"],
    keywords: ["audio", "audiobus", "sound", "music", "volume", "bus", "effect", "reverb", "sfx"],
  },
  {
    name: "spriteframes",
    description: "List, create, and edit SpriteFrames animations and import from spritesheets",
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
      "2d",
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
    description: "Search and inspect Godot class hierarchy — properties, methods, signals, inheritance",
    tools: ["classdb_get_info", "classdb_search"],
    keywords: ["class", "classdb", "api", "inheritance", "introspection"],
  },
];

/** All tool names that belong to groups (for filtering during eager tool registration). */
export const GROUP_TOOL_NAMES = new Set(GROUPS.flatMap((g) => g.tools));

// ── Tool lookup ──────────────────────────────────────────────────────

// Master lookup of every ToolDef by name, derived from the canonical
// ALL_TOOL_DEFS (src/catalogue.ts) so the lookup can never drift from the
// counted set. Eager const — no cycle, because catalogue.ts does not import
// groups.ts (group-loaded state lives in the leaf group_state.ts). This map
// is a superset of the group tools (it also holds eager-only tools like
// node/playtest); group code only ever looks up names it knows are group
// tools, so the extra entries are inert.
export const allDefs = new Map<string, ToolDef>(ALL_TOOL_DEFS.map((t) => [t.name, t]));

// Tools that route through the runtime (Mode B) bridge — the 3 runtime_advanced
// group tools (runtime_set_property demoted from eager → group in 41m-quinquies;
// it still routes via the runtime bridge, so it must live here). The 4 promoted
// tools (runtime_screenshot, input_simulate, runtime_get_script_vars,
// debugger_get_log) are now standard and handled by runtime.ts.
// Exported for the catalogue completeness guard (01_catalogue.ts): every
// runtime-bridge tool must resolve in ALL_TOOL_NAMES.
export const RUNTIME_TOOLS = new Set(["runtime_get_node_state", "runtime_set_property", "animation_player_control"]);

// LSP tools — use their own TCP client, not the bridge.
// Exported for the catalogue completeness guard (01_catalogue.ts).
export const LSP_TOOLS = new Set([
  "lsp_diagnostics",
  "lsp_hover",
  "lsp_completion",
  "lsp_definition",
  "lsp_symbols",
  "lsp_references",
]);
