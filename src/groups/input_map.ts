// input_map group — built-in group definition (data module).
import type { GroupDef } from "../group_types.js";

export const inputMapGroup: GroupDef = {
  name: "input_map",
  description: "List, create, and edit input actions and their key/controller bindings",
  tools: ["input_map_action", "input_map_event"],
  keywords: ["input", "input map", "action", "key binding", "keybind", "keyboard", "controller", "gamepad", "joystick"],
};
