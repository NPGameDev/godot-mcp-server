import { z, ZodRawShape } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Bridge, Profile, callAndWrap, includesInProfile } from "../types.js";

export type ToolDef = {
  name: string;
  method: string;
  description: string;
  inputSchema: ZodRawShape;
};

export const sceneTools: ToolDef[] = [
  {
    name: "scene_get_tree",
    method: "scene.get_tree",
    description:
      "Return the current edited scene's node tree as nested JSON { name, class, path, children }.",
    inputSchema: {},
  },
  {
    name: "scene_create_node",
    method: "scene.create_node",
    description:
      "Create a node of class_name under parent. Supports engine + user-defined class_name classes. Idempotent: 'returned' on collision, 'created' on fresh.",
    inputSchema: {
      class_name: z.string(),
      parent: z.string(),
      name: z.string().optional(),
    },
  },
  {
    name: "scene_delete_node",
    method: "scene.delete_node",
    description:
      "Delete the node at path (NodePath). Refuses to delete the edited scene root.",
    inputSchema: { path: z.string() },
  },
  {
    name: "scene_create",
    method: "scene.create",
    description:
      "Create .tscn at path; root_type = engine class or custom class_name (default Node). Idempotent. Returns status 'created'|'returned'|'replaced'. if_exists: 'return'(default)|'fail'|'replace'.",
    inputSchema: {
      path: z.string(),
      root_type: z.string().optional(),
      if_exists: z.enum(["return", "fail", "replace"]).optional(),
    },
  },
  {
    name: "scene_delete",
    method: "scene.delete",
    description:
      "Delete the .tscn and its .uid companion at path. Refuses non-.tscn paths and the currently-edited scene (codes INVALID_PATH / EDITED_SCENE).",
    inputSchema: { path: z.string() },
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
  },
];

export function register(server: McpServer, bridge: Bridge, profile: Profile = "full"): void {
  for (const tool of sceneTools) {
    if (!includesInProfile(tool.name, profile)) continue;
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      (input: unknown) => callAndWrap(bridge, tool.method, input),
    );
  }
}
