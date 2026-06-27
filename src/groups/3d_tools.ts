// 3d_tools group — built-in group definition (data module).
import type { GroupDef } from "../group_types.js";

export const threeDToolsGroup: GroupDef = {
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
};
