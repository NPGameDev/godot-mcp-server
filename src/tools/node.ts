import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Bridge } from "../types.js";
import { ToolDef } from "./scene.js";

export const nodeTools: ToolDef[] = [
  {
    name: "node_get_property",
    method: "node.get_property",
    description: "Read a property from the node at path. Returns { value } (engine types are dict-wrapped).",
    inputSchema: { path: z.string(), property: z.string() },
  },
  {
    name: "node_set_property",
    method: "node.set_property",
    description: "Set a property on the node at path. Engine types pass as { type, ... } dicts (e.g. {type:'Vector2',x:0,y:0}).",
    inputSchema: { path: z.string(), property: z.string(), value: z.unknown() },
  },
  {
    name: "node_get_property_list",
    method: "node.get_property_list",
    description: "Introspect inspector-visible properties of a node. Returns [{ name, type, hint, hint_string }] filtered by PROPERTY_USAGE_EDITOR.",
    inputSchema: { path: z.string() },
  },
];

export function register(server: McpServer, bridge: Bridge): void {
  for (const tool of nodeTools) {
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
