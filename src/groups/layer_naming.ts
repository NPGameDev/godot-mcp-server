// layer_naming group — built-in group definition (data module).
import type { GroupDef } from "../group_types.js";

export const layerNamingGroup: GroupDef = {
  name: "layer_naming",
  description: "Get and set physics, render, and navigation layer names",
  tools: ["layer_names_set", "layer_names_get"],
  keywords: ["layer", "layer name", "physics layer", "render layer", "collision layer", "collision mask", "mask"],
};
