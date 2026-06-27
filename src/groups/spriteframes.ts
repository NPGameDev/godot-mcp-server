// spriteframes group — built-in group definition (data module).
import type { GroupDef } from "../group_types.js";

export const spriteframesGroup: GroupDef = {
  name: "spriteframes",
  description: "List, create, and edit SpriteFrames animations and import from spritesheets",
  tools: ["spriteframes_create", "spriteframes_edit", "spriteframes_from_spritesheet"],
  keywords: [
    "sprite",
    "spriteframes",
    "animated sprite",
    "frame",
    "flipbook",
    "2d animation",
    "spritesheet",
    "atlas",
    "2d",
  ],
};
