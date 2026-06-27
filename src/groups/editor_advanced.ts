// editor_advanced group — built-in group definition (data module).
import type { GroupDef } from "../group_types.js";

export const editorAdvancedGroup: GroupDef = {
  name: "editor_advanced",
  description: "Capture editor screenshots, refresh the filesystem, and wait for idle",
  tools: ["editor_screenshot", "editor_refresh", "editor_wait_for_idle"],
  keywords: [
    "screenshot",
    "editor screenshot",
    "refresh",
    "reload scripts",
    "rescan",
    "filesystem",
    "reimport",
    "wait idle",
    "editor capture",
  ],
};
