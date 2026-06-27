// animation_authoring group — built-in group definition (data module).
import type { GroupDef } from "../group_types.js";

export const animationAuthoringGroup: GroupDef = {
  name: "animation_authoring",
  description: "Inspect and author keyframes, edit tracks, and configure AnimationTree state machines",
  tools: ["animation_keyframe", "animation_get_keys", "animationtree_edit"],
  keywords: [
    "animation",
    "keyframe",
    "track",
    "animate",
    "animationtree",
    "state machine",
    "blend tree",
    "transition",
    "blend",
  ],
};
