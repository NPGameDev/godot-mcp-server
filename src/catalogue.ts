// ── Canonical tool catalogue ─────────────────────────────────────────
//
// THE single source of truth for "every tool definition the server ships".
// ALL_TOOL_DEFS is the complete, deduplicated list of every per-module
// ToolDef array under src/tools/. Counting (the --tools-count CLI flag),
// the structural smoke catalogue (test/sections/01_catalogue.ts), the
// unfiltered structural checks (test/structural.ts), and the groups.ts
// name→def lookup all derive from this list — so a tool can never be
// counted in one place and missed in another.
//
// GUARDRAIL — enumeration only. This list is for counting and static
// validation. It is NOT the registration path: the eager set is still
// `allowed − GROUP_TOOL_NAMES` fed to per-module registerTools() in
// index.ts. Do not route runtime registration through ALL_TOOL_DEFS — it
// would eagerly advertise every tool and defeat the on-demand split.
//
// Maintenance: when a new src/tools/ module is added, import its ToolDef
// array here. The completeness guard in 01_catalogue.ts (GROUP/RUNTIME/LSP
// tool names ⊆ ALL_TOOL_NAMES) plus the no-duplicate-names assertion catch
// the common mistakes (forgotten array, double-counted convenience export).

import type { ToolDef } from "./types.js";

import { animationTools } from "./tools/animation.js";
import { assetTools } from "./tools/asset.js";
import { audioTools } from "./tools/audio.js";
import { classdbTools } from "./tools/classdb.js";
import { collisionTools } from "./tools/collision.js";
import { debugTools } from "./tools/debug.js";
import { diffTools } from "./tools/diff.js";
import { editorTools } from "./tools/editor.js";
import { fileTools } from "./tools/file.js";
import { folderTools } from "./tools/folder.js";
import { inputMapTools } from "./tools/input_map.js";
import { layerNameTools } from "./tools/layer_names.js";
import { lspAnalysisTools, lspNavigationTools } from "./tools/lsp.js";
import { navigationTools } from "./tools/navigation.js";
import { nodeTools } from "./tools/node.js";
import { nodeManagementTools } from "./tools/node_management.js";
import { particleTools } from "./tools/particles.js";
import { pathTools } from "./tools/path.js";
import { playtestTools } from "./tools/playtest.js";
import { proceduralTools } from "./tools/procedural.js";
import { resourceTools } from "./tools/resource.js";
import { runtimeTools } from "./tools/runtime.js";
import { saveTools } from "./tools/save.js";
import { sceneTools } from "./tools/scene.js";
import { sceneInheritanceTools } from "./tools/scene_inheritance.js";
import { sceneQueryTools } from "./tools/scene_query.js";
import { scriptTools } from "./tools/script.js";
import { signalTools } from "./tools/signals.js";
import { spriteframesTools } from "./tools/spriteframes.js";
import { themeTools } from "./tools/theme.js";
import { threeDTools } from "./tools/three_d.js";
import { tilemapTools } from "./tools/tilemap.js";
// NOTE: split tileset exports — NOT the unsplit `tilesetTools` convenience
// spread, which would double-count. Same reasoning applies to lsp above
// (lspAnalysisTools + lspNavigationTools, not the combined `lspTools`).
import { tilesetStructuralTools, tilesetEditTools } from "./tools/tileset.js";

/**
 * Every tool definition the server ships, across all src/tools/ modules.
 * Both eager and on-demand (group) tools live here — the eager/on-demand
 * split is a visibility partition over this set (see index.ts
 * buildModuleAllowed and groups.ts GROUP_TOOL_NAMES), not two pools.
 */
export const ALL_TOOL_DEFS: ToolDef[] = [
  ...animationTools,
  ...assetTools,
  ...audioTools,
  ...classdbTools,
  ...collisionTools,
  ...debugTools,
  ...diffTools,
  ...editorTools,
  ...fileTools,
  ...folderTools,
  ...inputMapTools,
  ...layerNameTools,
  ...lspAnalysisTools,
  ...lspNavigationTools,
  ...navigationTools,
  ...nodeTools,
  ...nodeManagementTools,
  ...particleTools,
  ...pathTools,
  ...playtestTools,
  ...proceduralTools,
  ...resourceTools,
  ...runtimeTools,
  ...saveTools,
  ...sceneTools,
  ...sceneInheritanceTools,
  ...sceneQueryTools,
  ...scriptTools,
  ...signalTools,
  ...spriteframesTools,
  ...themeTools,
  ...threeDTools,
  ...tilemapTools,
  ...tilesetStructuralTools,
  ...tilesetEditTools,
];

/** Names of every tool in ALL_TOOL_DEFS. */
export const ALL_TOOL_NAMES: Set<string> = new Set(ALL_TOOL_DEFS.map((t) => t.name));

/**
 * Always-registered tools that live OUTSIDE the per-module ToolDef arrays
 * (registered directly in index.ts / groups.ts, so absent from
 * ALL_TOOL_DEFS). Keep in sync with index.ts registerGroups() +
 * registerExtensionsRefresh(). Excludes per-project extension tools, which
 * are dynamic.
 */
export const META_TOOL_NAMES: readonly string[] = ["discover_tools", "extensions_refresh"];
