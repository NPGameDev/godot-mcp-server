// procedural group — built-in group definition (data module).
import type { GroupDef } from "../groupTypes.js";

export const proceduralGroup: GroupDef = {
  name: "procedural",
  description: "Edit gradients, curves, and FastNoiseLite resources for procedural generation",
  tools: ["procedural_edit_gradient", "procedural_edit_curve", "procedural_edit_noise"],
  keywords: ["procedural", "generate", "gradient", "noise", "curve", "resource create", "fastnoiselite", "easing"],
};
