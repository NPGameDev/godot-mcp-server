// tilemap group — built-in group definition (data module).
import type { GroupDef } from "../group_types.js";

export const tilemapGroup: GroupDef = {
  name: "tilemap",
  description: "Read and paint cells on TileMap/TileMapLayer nodes — cell queries, bulk fills, and region operations",
  tools: ["tilemap_read_cells", "tilemap_set_cells"],
  keywords: ["tilemap", "tile", "grid", "cell", "read cells", "paint cells", "2d"],
};
