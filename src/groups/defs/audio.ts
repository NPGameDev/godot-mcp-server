// audio group — built-in group definition (data module).
import type { GroupDef } from "../groupTypes.js";

export const audioGroup: GroupDef = {
  name: "audio",
  description: "List and configure audio buses, effects, and volume settings",
  tools: ["audiobus_edit", "audiobus_list"],
  keywords: ["audio", "audiobus", "sound", "music", "volume", "bus", "effect", "reverb", "sfx"],
};
