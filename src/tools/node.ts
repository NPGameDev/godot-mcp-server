import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Bridge, Profile, callAndWrap, includesInProfile } from "../types.js";
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
  {
    name: "node_call_method",
    method: "node.call_method",
    description:
      "Call node's method with args (Mode A/editor-side only in 15c). has_method-gated. Args + result support Resource refs via {type:'Resource',path:...}.",
    inputSchema: {
      path: z.string(),
      method: z.string(),
      args: z.array(z.unknown()).optional(),
    },
  },
  {
    name: "node_set_script",
    method: "node.set_script",
    description:
      "Attach a script (.gd/.cs) to a node. Returns @export properties exposed by the script. Empty script string detaches.",
    inputSchema: {
      path: z.string(),
      script: z.string(),
    },
  },
];

export function register(server: McpServer, bridge: Bridge, profile: Profile = "full"): void {
  for (const tool of nodeTools) {
    if (!includesInProfile(tool.name, profile)) continue;
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      (input: unknown) => callAndWrap(bridge, tool.method, input),
    );
  }
}
