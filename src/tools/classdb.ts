import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../shared/types.js";
import { registerTools } from "../registration/toolRegistry.js";
import { coercedBoolean } from "../shared/schemaCoercion.js";
import { offsetLimitParams, paginationDoc } from "../shared/pagination.js";

export const classdbTools: ToolDef[] = [
  {
    name: "classdb_get_info",
    method: "classdb.get_info",
    description:
      "Inspect any Godot class: properties, methods, signals, constants, inheritance. Supports engine + user class_name classes. " +
      paginationDoc("<section>", { resumable: true }) +
      "The envelope is per-section (properties, methods, signals, constants); offset and limit apply within each section (limit default 200, clamped above 200).",
    inputSchema: {
      class_name: z.string().describe("Engine class (e.g. RigidBody3D) or user-defined class_name."),
      include_inherited: coercedBoolean()
        .optional()
        .describe("Include inherited members (default: false, own class only)."),
      sections: z
        .array(z.enum(["properties", "methods", "signals", "constants"]))
        .optional()
        .describe("Which sections to return (default: all). Limit to reduce token cost."),
      ...offsetLimitParams,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "classdb_search",
    method: "classdb.search",
    description:
      "Find Godot classes by inheritance and/or name pattern. Returns class list with parent + instantiability. " +
      paginationDoc("classes", { resumable: true }) +
      "limit default 200, clamped above 200.",
    inputSchema: {
      base_class: z.string().optional().describe("Filter to subclasses of this class."),
      pattern: z.string().optional().describe("Case-insensitive substring match on class name."),
      instantiable_only: coercedBoolean().optional().describe("Exclude abstract classes (default: true)."),
      include_global: coercedBoolean().optional().describe("Include user class_name classes (default: true)."),
      ...offsetLimitParams,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];

export function register(server: McpServer, bridge: Bridge, allowedTools?: Set<string>): void {
  registerTools(server, bridge, classdbTools, allowedTools);
}
