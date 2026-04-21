import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../types.js";
import { callAndWrap } from "../types.js";

export const classdbTools: ToolDef[] = [
  {
    name: "classdb_get_info",
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
  {
    name: "classdb_search",
    method: "classdb.search",
    description:
      "Find Godot classes by inheritance and/or name pattern. Returns class list with parent + instantiability.",
    inputSchema: {
      base_class: z.string().optional().describe("Filter to subclasses of this class."),
      pattern: z.string().optional().describe("Case-insensitive substring match on class name."),
      instantiable_only: z.boolean().optional()
        .describe("Exclude abstract classes (default: true)."),
      include_global: z.boolean().optional()
        .describe("Include user class_name classes (default: true)."),
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
