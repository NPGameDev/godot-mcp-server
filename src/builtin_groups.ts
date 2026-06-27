/**
 * Built-in group assembly — imports the 28 per-group data modules (src/groups/*)
 * and assembles the canonical ordered GROUPS array. The element order here is the
 * single source of truth for discover_tools enumeration and every derived index
 * (GROUP_TOOL_NAMES et al. in group_catalogue.ts), so it MUST stay byte-stable.
 * Pure eager assembly — each per-group module fully executes before this module's
 * body runs, so GROUPS is fully populated by the time any importer reads it.
 * Extracted from group_catalogue.ts (concern 094, C1).
 */
import type { GroupDef } from "./group_types.js";

import { runtimeAdvancedGroup } from "./groups/runtime_advanced.js";
import { signalsGroup } from "./groups/signals.js";
import { animationAuthoringGroup } from "./groups/animation_authoring.js";
import { inputMapGroup } from "./groups/input_map.js";
import { resourceIoGroup } from "./groups/resource_io.js";
import { assetOpsGroup } from "./groups/asset_ops.js";
import { placeholdersGroup } from "./groups/placeholders.js";
import { cleanupGroup } from "./groups/cleanup.js";
import { userDataGroup } from "./groups/user_data.js";
import { sceneAdvancedGroup } from "./groups/scene_advanced.js";
import { editorAdvancedGroup } from "./groups/editor_advanced.js";
import { tilemapGroup } from "./groups/tilemap.js";
import { tilesetGroup } from "./groups/tileset.js";
import { tilesetEditGroup } from "./groups/tileset_edit.js";
import { themeGroup } from "./groups/theme.js";
import { layerNamingGroup } from "./groups/layer_naming.js";
import { pathEditingGroup } from "./groups/path_editing.js";
import { threeDToolsGroup } from "./groups/3d_tools.js";
import { proceduralGroup } from "./groups/procedural.js";
import { sceneInheritanceGroup } from "./groups/scene_inheritance.js";
import { audioGroup } from "./groups/audio.js";
import { spriteframesGroup } from "./groups/spriteframes.js";
import { particlesGroup } from "./groups/particles.js";
import { navigationGroup } from "./groups/navigation.js";
import { lspCodeAnalysisGroup } from "./groups/lsp_code_analysis.js";
import { lspCodeNavigationGroup } from "./groups/lsp_code_navigation.js";
import { debuggerGroup } from "./groups/debugger.js";
import { classdbGroup } from "./groups/classdb.js";

// Canonical group order — byte-identical to the pre-C1 group_catalogue.ts literal
// (placeholders is 7th; classdb is last). Do NOT reorder.
export const GROUPS: GroupDef[] = [
  runtimeAdvancedGroup,
  signalsGroup,
  animationAuthoringGroup,
  inputMapGroup,
  resourceIoGroup,
  assetOpsGroup,
  placeholdersGroup,
  cleanupGroup,
  userDataGroup,
  sceneAdvancedGroup,
  editorAdvancedGroup,
  tilemapGroup,
  tilesetGroup,
  tilesetEditGroup,
  themeGroup,
  layerNamingGroup,
  pathEditingGroup,
  threeDToolsGroup,
  proceduralGroup,
  sceneInheritanceGroup,
  audioGroup,
  spriteframesGroup,
  particlesGroup,
  navigationGroup,
  lspCodeAnalysisGroup,
  lspCodeNavigationGroup,
  debuggerGroup,
  classdbGroup,
];
