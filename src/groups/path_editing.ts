// path_editing group — built-in group definition (data module).
import type { GroupDef } from "../group_types.js";

export const pathEditingGroup: GroupDef = {
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
};
