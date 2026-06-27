// tileset group — built-in group definition (data module).
import type { GroupDef } from "../group_types.js";

export const tilesetGroup: GroupDef = {
  name: "tileset",
  description: "Create TileSet resources, add atlas sources, configure layers, and manage tile alternatives",
  tools: [
    "tileset_create",
    "tileset_add_source",
    "tileset_remove_source",
    "tileset_add_alternative",
    "tileset_remove_alternative",
    "tileset_setup_layers",
  ],
  keywords: [
    "tileset",
    "atlas",
    "tile source",
    "tile layer",
    "terrain set",
    "tile alternative",
    "tile variant",
    "create tileset",
  ],
};
