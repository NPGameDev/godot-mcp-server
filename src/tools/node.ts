import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../types.js";
import { registerTools } from "../tool_helpers.js";

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
      "All supported type tags: Vector2, Vector3, Vector4, Vector2i, Vector3i, Color, Rect2, Rect2i, " +
      "Transform2D, Transform3D, NodePath, Resource, NewResource, PackedVector2Array, PackedVector3Array, PackedColorArray. " +
      "Unknown type tags are rejected with an error listing supported types.\n\n" +
      "Anchor presets: setting anchors_preset alone may not auto-apply underlying values. " +
      "For reliable layout, set anchor_left/top/right/bottom and offset_left/top/right/bottom explicitly.\n\n" +
      "Batch mode: pass batch:[{node_path, property, value}, ...] to set multiple properties in one UndoRedo action.",
    inputSchema: {
      node_path: z.string().optional().describe("Single mode: path to target node"),
      property: z
        .string()
        .optional()
        .describe(
          "Single mode: property name. Compound '/' paths supported. Use ':' for sub-resource chaining (e.g. 'material:shader_parameter/value').",
        ),
      value: z.unknown().optional(),
      batch: z
        .array(
          z.object({
            node_path: z.string(),
            property: z.string(),
            value: z.unknown(),
          }),
        )
        .min(1)
        .optional()
        .describe(
          "Batch mode: array of {node_path, property, value}. All changes in a single UndoRedo action. " +
            "When present, top-level node_path/property/value are ignored.",
        ),
    },
    annotations: { openWorldHint: false },
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
    annotations: { openWorldHint: false },
  },
  // node_call_method is feature-gated (single-gate: env OR PS). Plugin-side
  // FeatureGate performs the full check as defence-in-depth; the gate here
  // controls MCP catalogue visibility only.
  {
    name: "node_call_method",
    method: "node.call_method",
    description: "Call method with args on an edited-scene node (editor-only; for runtime nodes use execute_code).",
    inputSchema: {
      node_path: z.string(),
      method_name: z.string(),
      args: z.array(z.unknown()).optional(),
    },
    annotations: { openWorldHint: false },
    gate: "node_call_method",
  },
];

export function register(server: McpServer, bridge: Bridge, allowedTools: Set<string> | null = null): void {
  registerTools(server, bridge, nodeTools, allowedTools);
}
