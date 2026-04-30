import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../types.js";
import { registerTools } from "../tool_helpers.js";

export const sceneTools: ToolDef[] = [
  {
    name: "scene_get_tree",
    method: "scene.get_tree",
    description: "Return the current edited scene's node tree as nested JSON { name, class, path, children }.",
    inputSchema: {
      depth: z.number().optional().describe("Tree depth. Default 2. Use -1 for full tree."),
      include_properties: z.boolean().optional().describe("Embed property snapshot per node. Default false."),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "scene_create_node",
    method: "scene.create_node",
    description:
      "Create a node of class_name under parent. Supports engine + user-defined class_name classes. Idempotent: 'returned' on collision, 'created' on fresh.",
    inputSchema: {
      class_name: z.string(),
      parent_path: z.string(),
      node_name: z.string().optional(),
      layout_mode: z
        .number()
        .optional()
        .describe("Layout mode for Control nodes: 0=free, 1=anchors. Auto-sets 1 when parent is Container."),
    },
    annotations: { idempotentHint: true, openWorldHint: false },
  },
  {
    name: "scene_delete_node",
    method: "scene.delete_node",
    description: "Delete the node at path (NodePath). Refuses to delete the edited scene root.",
    inputSchema: { node_path: z.string() },
    annotations: { destructiveHint: true, openWorldHint: false },
  },
  {
    name: "scene_create",
    method: "scene.create",
    description:
      "Create .tscn at file_path. Root name = filename stem at '.'. root_type default Node. Idempotent: created|returned|replaced. if_exists: return|fail|replace. Use scene_open afterward to edit.",
    inputSchema: {
      file_path: z.string(),
      root_type: z.string().optional(),
      if_exists: z.enum(["return", "fail", "replace"]).optional(),
    },
    annotations: { idempotentHint: true, openWorldHint: false },
  },
  {
    name: "scene_delete",
    method: "scene.delete",
    description:
      "Delete the .tscn and its .uid companion at path. Refuses non-.tscn paths and the currently-edited scene (codes INVALID_PATH / EDITED_SCENE).",
    inputSchema: { file_path: z.string() },
    annotations: { destructiveHint: true, openWorldHint: false },
  },
  {
    name: "scene_instantiate",
    method: "scene.instantiate",
    description:
      "Instantiate PackedScene at packed_path under parent_path. Silent-return on name collision (status: returned). UndoRedo-wrapped; owner set for save.",
    inputSchema: {
      parent_path: z.string(),
      packed_path: z.string(),
      as_name: z.string().optional(),
      transform: z.record(z.string(), z.unknown()).optional(),
    },
    annotations: { idempotentHint: true, openWorldHint: false },
  },
];

export function register(server: McpServer, bridge: Bridge, allowedTools: Set<string> | null = null): void {
  registerTools(server, bridge, sceneTools, allowedTools);
}
