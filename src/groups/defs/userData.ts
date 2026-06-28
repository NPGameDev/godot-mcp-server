// user_data group — built-in group definition (data module).
import type { GroupDef } from "../groupTypes.js";

export const userDataGroup: GroupDef = {
  name: "user_data",
  description: "Read, write, delete, and list user:// save files",
  tools: ["save_read", "save_write", "save_delete", "save_list"],
  keywords: ["save", "save file", "user data", "persistence", "save game", "load game", "savegame"],
};
