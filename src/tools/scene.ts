import { z, ZodRawShape } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Bridge } from "../types.js";

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
      "Create a node of class_name under parent (NodePath). Idempotent: returns existing path if a sibling with the same name exists.",
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
];

export function register(server: McpServer, bridge: Bridge): void {
  for (const tool of sceneTools) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      async (input: unknown) => {
        const result = await bridge.call(tool.method, input);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      },
    );
  }
}
