// scene_inheritance group — built-in group definition (data module).
import type { GroupDef } from "../groupTypes.js";

export const sceneInheritanceGroup: GroupDef = {
  name: "scene_inheritance",
  description: "Create inherited scenes (variants) from base scenes",
  tools: ["scene_create_inherited"],
  keywords: ["inheritance", "inherited scene", "prefab", "variant", "base scene", "scene extend", "inherit"],
};
