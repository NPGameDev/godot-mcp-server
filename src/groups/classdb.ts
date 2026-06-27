// classdb group — built-in group definition (data module).
import type { GroupDef } from "../group_types.js";

export const classdbGroup: GroupDef = {
  name: "classdb",
  description: "Search and inspect Godot class hierarchy — properties, methods, signals, inheritance",
  tools: ["classdb_get_info", "classdb_search"],
  keywords: ["class", "classdb", "api", "inheritance", "introspection"],
};
