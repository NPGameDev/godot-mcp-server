/**
 * Group type leaf — the {@link GroupName} string-literal union (every built-in
 * group's canonical name) and the {@link GroupDef} shape
 * (name/description/tools/keywords) that each `GROUPS` entry conforms to. Pure
 * types with zero runtime imports, so any module can depend on the group
 * vocabulary without pulling in the catalogue data.
 *
 * @module
 */

/** Canonical name of a built-in tool group. */
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

/** One built-in group catalogue entry: its name, blurb, member tool names, and discovery keywords. */
export interface GroupDef {
  name: GroupName;
  description: string;
  tools: string[];
  keywords: string[];
}
