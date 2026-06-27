// theme group — built-in group definition (data module).
import type { GroupDef } from "../group_types.js";

export const themeGroup: GroupDef = {
  name: "theme",
  description: "Edit UI theme overrides: styleboxes, fonts, colors, and constants",
  tools: ["theme_edit"],
  keywords: ["theme", "style", "stylebox", "font", "color", "ui style", "control theme"],
};
