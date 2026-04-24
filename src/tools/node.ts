import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../types.js";
import { registerTools } from "../types.js";
import { isEnabled } from "../feature_gate.js";

export const nodeTools: ToolDef[] = [
  {
    name: "node_get_property",
    method: "node.get_property",
    description: "Read a property from the node at path. Returns { value } (engine types are dict-wrapped).",
    inputSchema: { node_path: z.string(), property: z.string() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "node_set_property",
    method: "node.set_property",
    description:
      "Set a property on the node at node_path. Engine types pass as { type, ... } dicts (e.g. {type:'Vector2',x:0,y:0}).",
    inputSchema: { node_path: z.string(), property: z.string(), value: z.unknown() },
    annotations: { openWorldHint: false },
  },
  {
    name: "node_get_property_list",
    method: "node.get_property_list",
    description:
      "Introspect inspector-visible properties of a node. Returns [{ name, type, hint, hint_string }] filtered by PROPERTY_USAGE_EDITOR.",
    inputSchema: {
      node_path: z.string(),
      mask: z
        .enum(["common", "all", "groups"])
        .optional()
        .describe(
          "Property filter. 'common' (default) returns 8-12 most-edited. 'all' returns full list. 'groups' returns names+usage only.",
        ),
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
];

// node_call_method is feature-gated (single-gate: env OR PS). Plugin-side
// FeatureGate performs the full check as defence-in-depth; this controls
// MCP catalogue visibility only.
if (isEnabled("node_call_method")) {
  nodeTools.push({
    name: "node_call_method",
    method: "node.call_method",
    description:
      "Call node's method with args (editor-side only). has_method-gated. Args + result support Resource refs via {type:'Resource',path:...}.",
    inputSchema: {
      node_path: z.string(),
      method_name: z.string(),
      args: z.array(z.unknown()).optional(),
    },
    annotations: { openWorldHint: false },
  });
}

export function register(server: McpServer, bridge: Bridge, allowedTools: Set<string> | null = null): void {
  registerTools(server, bridge, nodeTools, allowedTools);
}
