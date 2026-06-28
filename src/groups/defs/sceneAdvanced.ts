// scene_advanced group — built-in group definition (data module).
import type { GroupDef } from "../groupTypes.js";

export const sceneAdvancedGroup: GroupDef = {
  name: "scene_advanced",
  description: "Diff scenes and batch-instantiate nodes from packed scenes",
  tools: ["scene_diff", "scene_instantiate"],
  keywords: ["instantiate", "instance", "scene diff", "compare", "prefab", "spawn", "batch instantiate"],
};
