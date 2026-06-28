// runtime_advanced group — built-in group definition (data module).
import type { GroupDef } from "../groupTypes.js";

export const runtimeAdvancedGroup: GroupDef = {
  name: "runtime_advanced",
  description: "Inspect live node state, set node properties, and control AnimationPlayer during playtests",
  tools: ["runtime_get_node_state", "runtime_set_property", "animation_player_control"],
  keywords: [
    "runtime",
    "node state",
    "set property",
    "runtime property",
    "animation playback",
    "animationplayer",
    "play animation",
    "stop animation",
    "animation control",
    "inspect node",
  ],
};
