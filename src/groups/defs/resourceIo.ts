// resource_io group — built-in group definition (data module).
// FIX-3: asset_management (10 tools) split into 3 groups (2+2+6).
import type { GroupDef } from "../groupTypes.js";

export const resourceIoGroup: GroupDef = {
  name: "resource_io",
  description: "Load and write Godot resources (.tres/.res) programmatically",
  tools: ["resource_load", "resource_write"],
  keywords: ["resource", "load", "write", "save resource", "tres", "res"],
};
