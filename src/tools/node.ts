import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../types.js";
import { registerTools } from "../tool_registry.js";

export const nodeTools: ToolDef[] = [
  {
    name: "node_get_property",
    method: "node.get_property",
    description: "Read a property from the node at path. Returns { value } (engine types are dict-wrapped).",
    inputSchema: {
      node_path: z.string(),
      property: z
        .string()
        .describe("Property name. Use ':' to chain into sub-resources (e.g. 'material:shader_parameter/value')."),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    successHint:
      "For available properties use node_get_property_list. For tree-wide overview use scene_get_tree with include_properties.",
  },
  // I2 waiver: node_set_property description exceeds 200-char limit.
  // Editor-time vs runtime distinction (F21/F33) and anchors-preset
  // pitfall (F24) both materially reduce mis-calls.
  {
    name: "node_set_property",
    method: "node.set_property",
    description:
      "Set a property on a node in the EDITOR scene tree (saved to .tscn files). " +
      "Does NOT affect the running game — for runtime property changes during playtesting, use runtime_set_property.\n\n" +
      'Node paths are relative to the edited scene root: "." is root, "./Player" is a direct child, "./Player/Sprite2D" for deeper nodes.\n\n' +
      "Engine types: {type:'Vector2',x,y}. Inline sub-resources: {type:'NewResource',class:'CircleShape2D',properties:{radius:50}}. " +
      "External resources (textures, audio, tilesets, materials): {type:'Resource', path:'res://path/to/file.tres'}. " +
      "Packed arrays: {type:'PackedVector2Array', values:[{type:'Vector2',x:0,y:0}, ...]}. " +
      "Collision layers: {type:'LayerMask', layers:[1,4,6]} (by number) or {type:'LayerMask', layers:['player','walls']} (by name from layer_names_set); optional category defaults to '2d_physics'. " +
      "All supported type tags: Vector2, Vector3, Vector4, Vector2i, Vector3i, Color, Rect2, Rect2i, " +
      "Transform2D, Transform3D, NodePath, Resource, NewResource, PackedVector2Array, PackedVector3Array, PackedColorArray, LayerMask. " +
      "Unknown type tags are rejected with an error listing supported types.\n\n" +
      "Anchor presets: setting anchors_preset alone may not auto-apply underlying values. " +
      "For reliable layout, set anchor_left/top/right/bottom and offset_left/top/right/bottom explicitly.\n\n" +
      "Batch mode: pass batch:[{node_path, property, value, make_unique?}, ...] to set multiple properties at once.",
    inputSchema: {
      node_path: z.string().optional().describe("Single mode: path to target node"),
      property: z
        .string()
        .optional()
        .describe(
          "Single mode: property name. Compound '/' paths supported. Use ':' for sub-resource chaining (e.g. 'material:shader_parameter/value').",
        ),
      value: z.unknown().optional(),
      make_unique: z
        .boolean()
        .optional()
        .describe(
          "When true and the compound path targets an external (.tres) sub-resource, " +
            "auto-duplicate it as an inline copy before setting. " +
            "Equivalent to the Inspector's 'Make Unique'. Only needed for compound paths on external resources.",
        ),
      batch: z
        .array(
          z.object({
            node_path: z.string(),
            property: z.string(),
            value: z.unknown(),
            make_unique: z
              .boolean()
              .optional()
              .describe("Per-entry make_unique — auto-duplicate external sub-resource as inline copy."),
          }),
        )
        .optional()
        .describe(
          "Batch mode: array of {node_path, property, value, make_unique?}. " +
            "Omit for single-property operations. " +
            "When present, top-level node_path/property/value are ignored.",
        ),
    },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
    successHint: "Save changes with editor_save_scene. For batch edits, use the batch array in a single call.",
  },
  {
    name: "node_get_property_list",
    method: "node.get_property_list",
    description:
      "Introspect node properties. mask: common (default), all, groups, script. 'script' returns all script variables with public/private label; use visibility param to filter.",
    inputSchema: {
      node_path: z.string(),
      mask: z
        .enum(["common", "all", "groups", "script"])
        .optional()
        .describe(
          "Property filter. 'common' (default) returns 8-12 most-edited. 'all' returns full list. 'groups' returns names+usage only. 'script' returns script variables with visibility label.",
        ),
      visibility: z
        .enum(["public", "private", "all"])
        .optional()
        .default("all")
        .describe("Filter for mask='script'. 'public' = no _ prefix, 'private' = _ prefix, 'all' = both."),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    successHint: "For specific values use node_get_property. Filter with mask parameter (common/all/groups/script).",
  },
  {
    name: "node_set_script",
    method: "node.set_script",
    description:
      "Attach a script (.gd/.cs) to a node. Returns @export properties exposed by the script. Empty script_path string detaches.",
    inputSchema: {
      node_path: z.string(),
      script_path: z.string(),
    },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
    successHint: "Write script content with script_write. View @export properties in the returned property list.",
    // script_path is a res:// file path; node_path is a scene-tree path (not guarded).
    // Empty script_path (detach) is skipped by checkPathGuard, deferring to the toolkit.
    pathParams: [{ param: "script_path", guard: "project" }],
  },
  {
    name: "control_set_layout",
    method: "control.set_layout",
    description:
      "Set anchor preset + optional margins on a Control node in one call. Uses set_anchors_and_offsets_preset(). Returns final_rect.",
    inputSchema: {
      node_path: z.string(),
      preset: z
        .string()
        .describe(
          "Layout preset: PRESET_TOP_LEFT, PRESET_TOP_RIGHT, PRESET_BOTTOM_LEFT, PRESET_BOTTOM_RIGHT, " +
            "PRESET_CENTER_LEFT, PRESET_CENTER_TOP, PRESET_CENTER_RIGHT, PRESET_CENTER_BOTTOM, " +
            "PRESET_CENTER, PRESET_LEFT_WIDE, PRESET_TOP_WIDE, PRESET_RIGHT_WIDE, PRESET_BOTTOM_WIDE, " +
            "PRESET_VCENTER_WIDE, PRESET_HCENTER_WIDE, PRESET_FULL_RECT",
        ),
      resize_mode: z
        .enum(["keep_size", "set_to_anchors"])
        .optional()
        .describe("keep_size (default) preserves size; set_to_anchors resizes to anchor region."),
      margins: z
        .object({
          left: z.coerce.number().optional(),
          right: z.coerce.number().optional(),
          top: z.coerce.number().optional(),
          bottom: z.coerce.number().optional(),
        })
        .optional()
        .describe("Additive offsets applied after the preset (in pixels)."),
    },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
    successHint: "Margins are applied AFTER the preset. For Container children, layout is overridden by the parent.",
  },
  // node_call_method can call arbitrary methods — risk communicated via
  // destructiveHint annotation. Agent-side filtering recommended for
  // untrusted contexts (see security-recommendations.md).
  {
    name: "node_call_method",
    method: "node.call_method",
    description: "Call method with args on an edited-scene node (editor-only; for runtime nodes use execute_code).",
    inputSchema: {
      node_path: z.string(),
      method_name: z.string(),
      args: z.array(z.unknown()).optional(),
    },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: true },
  },
];

export function register(server: McpServer, bridge: Bridge, allowedTools: Set<string> | null = null): void {
  registerTools(server, bridge, nodeTools, allowedTools);
}
