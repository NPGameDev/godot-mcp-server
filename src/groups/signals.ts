// signals group — built-in group definition (data module).
import type { GroupDef } from "../group_types.js";

export const signalsGroup: GroupDef = {
  name: "signals",
  description: "Emit signals on scene nodes at editor-time or runtime",
  tools: ["signal_emit"],
  keywords: ["signal", "emit", "observer", "event", "handler", "callback"],
};
