// asset_ops group — built-in group definition (data module).
import type { GroupDef } from "../group_types.js";

export const assetOpsGroup: GroupDef = {
  name: "asset_ops",
  description: "List assets, query dependencies, and import binary files into the project",
  tools: ["asset_list", "asset_get_dependencies", "asset_import"],
  keywords: ["asset", "import", "dependencies", "texture", "image", "list assets", "files", "browse"],
};
