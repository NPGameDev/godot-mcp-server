/**
 * Built-in group assembly — imports the 28 per-group data modules (src/groups/*)
 * and assembles the canonical ordered GROUPS array. The element order here is the
 * single source of truth for discover_tools enumeration and every derived index
 * (GROUP_TOOL_NAMES et al. in group_catalogue.ts), so it MUST stay byte-stable.
 * Pure eager assembly — each per-group module fully executes before this module's
 * body runs, so GROUPS is fully populated by the time any importer reads it.
 * Extracted from group_catalogue.ts (concern 094, C1).
 */
import type { GroupDef } from "./groupTypes.js";

import { runtimeAdvancedGroup } from "./defs/runtimeAdvanced.js";
import { signalsGroup } from "./defs/signals.js";
import { animationAuthoringGroup } from "./defs/animationAuthoring.js";
import { inputMapGroup } from "./defs/inputMap.js";
import { resourceIoGroup } from "./defs/resourceIo.js";
import { assetOpsGroup } from "./defs/assetOps.js";
import { placeholdersGroup } from "./defs/placeholders.js";
import { cleanupGroup } from "./defs/cleanup.js";
import { userDataGroup } from "./defs/userData.js";
import { sceneAdvancedGroup } from "./defs/sceneAdvanced.js";
import { editorAdvancedGroup } from "./defs/editorAdvanced.js";
import { tilemapGroup } from "./defs/tilemap.js";
import { tilesetGroup } from "./defs/tileset.js";
import { tilesetEditGroup } from "./defs/tilesetEdit.js";
import { themeGroup } from "./defs/theme.js";
import { layerNamingGroup } from "./defs/layerNaming.js";
import { pathEditingGroup } from "./defs/pathEditing.js";
import { threeDToolsGroup } from "./defs/3dTools.js";
import { proceduralGroup } from "./defs/procedural.js";
import { sceneInheritanceGroup } from "./defs/sceneInheritance.js";
import { audioGroup } from "./defs/audio.js";
import { spriteframesGroup } from "./defs/spriteframes.js";
import { particlesGroup } from "./defs/particles.js";
import { navigationGroup } from "./defs/navigation.js";
import { lspCodeAnalysisGroup } from "./defs/lspCodeAnalysis.js";
import { lspCodeNavigationGroup } from "./defs/lspCodeNavigation.js";
import { debuggerGroup } from "./defs/debugger.js";
import { classdbGroup } from "./defs/classdb.js";

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
