/**
 * Group type leaf — the GroupName string-literal union (every built-in group's
 * canonical name) and the GroupDef shape (name/description/tools/keywords) that
 * each GROUPS entry conforms to. Pure types with zero runtime imports, so any
 * module can depend on the group vocabulary without pulling in the catalogue
 * data. Extracted from group_catalogue.ts (concern 094, C0).
 */

export type GroupName =
  | "runtime_advanced"
  | "signals"
  | "animation_authoring"
  | "input_map"
  | "resource_io"
  | "asset_ops"
  | "cleanup"
  | "user_data"
  | "scene_advanced"
  | "editor_advanced"
  | "tilemap"
  | "tileset"
  | "tileset_edit"
  | "theme"
  | "layer_naming"
  | "path_editing"
  | "3d_tools"
  | "procedural"
  | "scene_inheritance"
  | "audio"
  | "spriteframes"
  | "particles"
  | "navigation"
  | "lsp_code_analysis"
  | "lsp_code_navigation"
  | "debugger"
  | "classdb"
  | "placeholders";

export interface GroupDef {
  name: GroupName;
  description: string;
  tools: string[];
  keywords: string[];
}
