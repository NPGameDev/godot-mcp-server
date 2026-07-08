import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../shared/types.js";
import { registerTools } from "../registration/toolRegistry.js";
import { jsonCoerce, coercedBoolean } from "../shared/schemaCoercion.js";
import { PROJECT_FILE_PATH } from "../security/pathGuard.js";

export const sceneTools: ToolDef[] = [
  {
    name: "scene_get_tree",
    method: "scene.get_tree",
    description:
      'Return the current edited scene\'s node tree as nested JSON { name, class, path, children }. Paths use "." for root — pass them directly to other editor commands.',
    inputSchema: {
      max_depth: z.coerce.number().optional().describe("Tree depth. Default 2. Use -1 for full tree."),
      include_properties: coercedBoolean().optional().describe("Embed property snapshot per node. Default false."),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    successHint: "For filtered node search use scene_query. For specific node details use node_get_property.",
  },
  // Param examples in scene_create_node and scene_instantiate are deliberately
  // included to fix parameter-naming confusion.
  {
    name: "scene_create_node",
    method: "scene.create_node",
    description:
      "Create a node of class_name under parent. Supports engine + user-defined class_name classes. Idempotent: 'returned' on collision, 'created' on fresh.\n\n" +
      'Example: class_name: "CharacterBody2D", parent_path: ".", node_name: "Player"',
    inputSchema: {
      class_name: z.string(),
      parent_path: z.string(),
      node_name: z.string().optional(),
      layout_mode: z
        .number()
        .optional()
        .describe("Layout mode for Control nodes: 0=free, 1=anchors. Auto-sets 1 when parent is Container."),
      unique_name: coercedBoolean()
        .optional()
        .describe(
          "Mark as scene-unique node for %Name access in scripts. Warns if name collides with existing unique node.",
        ),
      properties: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          "Inline property values set after creation. " +
            "Same coercion as node_set_property. Partial failure keeps the node — check properties_failed. " +
            "Dict iteration order is not guaranteed.",
        ),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    successHint: "Configure with node_set_property. Attach script with node_set_script. Save with editor_save_scene.",
  },
  {
    name: "scene_delete_node",
    method: "scene.delete_node",
    description: "Delete the node at path (NodePath). Refuses to delete the edited scene root.",
    inputSchema: { node_path: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  },
  {
    name: "scene_create",
    method: "scene.create",
    description:
      "Create .tscn at file_path. Root name = filename stem at '.'. root_type default Node. Idempotent: created|returned|replaced. if_exists: return|fail|replace. Use scene_open afterward to edit.",
    inputSchema: {
      file_path: z.string(),
      root_type: z.string().optional(),
      root_name: z.string().optional().describe("Root node name override (default: filename stem)."),
      if_exists: z.enum(["return", "fail", "replace"]).optional(),
    },
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false, destructiveHint: false },
    successHint: "Open with scene_open to make it the active scene, then add nodes with scene_create_node.",
    pathParams: [PROJECT_FILE_PATH],
  },
  {
    name: "scene_delete",
    method: "scene.delete",
    description:
      "Delete .tscn at path and .uid companion. Auto-closes editor tab on 4.5+ (tab_closed:true). 4.2-4.4: blocks active scene (EDITED_SCENE); non-active tabs get phantom warnings. Refuses non-.tscn.",
    inputSchema: { file_path: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    successHint:
      "Only for .tscn/.scn files. Scripts: script_delete. Resources: resource_delete. Other files: file_delete.",
    pathParams: [PROJECT_FILE_PATH],
  },
  {
    name: "scene_instantiate",
    method: "scene.instantiate",
    description:
      "Instantiate PackedScene at scene_path under parent_path. Single mode: silent-return on name collision. " +
      "Batch mode: pass instances array to spawn N copies with transforms.\n\n" +
      'Single: scene_path: "res://coin.tscn", parent_path: ".", as_name: "Coin"\n' +
      'Batch: scene_path: "res://coin.tscn", parent_path: ".", instances: [{name:"Coin1",position:{x:100,y:200},properties:{coin_value:5}}, ...]',
    inputSchema: {
      parent_path: z.string(),
      scene_path: z.string(),
      as_name: z.string().optional().describe("Single mode: instance name."),
      transform: z.record(z.string(), z.unknown()).optional().describe("Single mode: property overrides."),
      instances: z
        .preprocess(jsonCoerce, z.array(z.record(z.string(), z.unknown())))
        .optional()
        .describe(
          "Batch mode: array of {name?, position?, rotation?, scale?, properties?}. " +
            "properties: arbitrary overrides applied after instantiation (e.g. {key_type: 'Gold'}). " +
            "When present, spawns N instances as a batch. " +
            "as_name and transform are ignored in batch mode.",
        ),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    successHint: "Configure instance properties with node_set_property. Save with editor_save_scene.",
    pathParams: [{ param: "scene_path", guard: "project" }],
  },
];

export function register(server: McpServer, bridge: Bridge, allowedTools?: Set<string>): void {
  registerTools(server, bridge, sceneTools, allowedTools);
}
