// cleanup group — built-in group definition (data module).
import type { GroupDef } from "../group_types.js";

export const cleanupGroup: GroupDef = {
  name: "cleanup",
  description: "Delete files, scripts, scenes, resources, and folders; close open scenes",
  tools: ["file_delete", "scene_delete", "script_delete", "resource_delete", "folder_delete", "scene_close"],
  keywords: ["delete", "cleanup", "close", "remove", "delete file", "delete scene", "delete script"],
};
