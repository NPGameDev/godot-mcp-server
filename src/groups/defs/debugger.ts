// debugger group — built-in group definition (data module).
import type { GroupDef } from "../groupTypes.js";

export const debuggerGroup: GroupDef = {
  name: "debugger",
  description: "Inspect debugger state, manage breakpoints, and control execution flow",
  tools: ["debug_state", "debug_list_breakpoints", "debug_set_breakpoint", "debug_continue"],
  keywords: ["debug", "breakpoint", "pause", "continue", "step", "debugger", "state", "breaked"],
};
