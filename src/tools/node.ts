import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../types.js";
import { registerTools } from "../tool_helpers.js";

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
      "Set a property on a node. Engine types: {type:'Vector2',x,y}. Inline sub-resources: {type:'NewResource',class:'CircleShape2D',properties:{radius:50}}.",
    inputSchema: { node_path: z.string(), property: z.string(), value: z.unknown() },
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
    description:
      "Call method with args on an edited-scene node (editor-only; for runtime nodes use game_eval). Gate: GODOT_MCP_ALLOW_NODE_CALL_METHOD.",
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
