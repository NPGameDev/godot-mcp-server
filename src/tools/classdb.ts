import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../types.js";
import { callAndWrap } from "../types.js";

export const classdbTools: ToolDef[] = [
  {
    name: "classdb_get_info",
    tier: "lite",
    method: "classdb.get_info",
    description:
      "Inspect any Godot class: properties, methods, signals, constants, inheritance. Supports engine + user class_name classes.",
    inputSchema: {
      class_name: z.string().describe("Engine class (e.g. RigidBody3D) or user-defined class_name."),
      include_inherited: z.boolean().optional()
        .describe("Include inherited members (default: false, own class only)."),
      sections: z.array(z.enum(["properties", "methods", "signals", "constants"])).optional()
        .describe("Which sections to return (default: all). Limit to reduce token cost."),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];

export function register(server: McpServer, bridge: Bridge, allowedTools: Set<string> | null = null): void {
  for (const tool of classdbTools) {
    if (allowedTools && !allowedTools.has(tool.name)) continue;
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      },
      (input: unknown) => callAndWrap(bridge, tool.method, input),
    );
  }
}
