// tileset_edit group — built-in group definition (data module).
import type { GroupDef } from "../groupTypes.js";

export const tilesetEditGroup: GroupDef = {
  name: "tileset_edit",
  description: "Edit per-tile properties: physics, terrain, navigation, visuals, and custom data",
  tools: [
    "tileset_edit_physics",
    "tileset_edit_terrain",
    "tileset_edit_navigation",
    "tileset_edit_visuals",
    "tileset_edit_custom_data",
  ],
  keywords: [
    "tileset collision",
    "tile physics",
    "tile terrain",
    "tile navigation",
    "tile occlusion",
    "tile animation",
    "tile custom data",
    "peering bits",
  ],
};
