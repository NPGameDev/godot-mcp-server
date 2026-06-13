import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../types.js";
import { registerTools } from "../tool_helpers.js";
import { PROJECT_FILE_PATH } from "../path_guard.js";

export const resourceTools: ToolDef[] = [
  {
    name: "resource_load",
    method: "resource.load",
    description:
      "Load a res:// resource and return { class, path, properties, metadata }. Heavy fields (image, mesh_arrays) pruned; Texture2D gets size in metadata.",
    inputSchema: { file_path: z.string() },
    annotations: { readOnlyHint: true, openWorldHint: false },
    pathParams: [PROJECT_FILE_PATH],
  },
  {
    name: "resource_write",
    method: "resource.write",
    description:
      "Write/create a .tres/.res resource. If file exists, updates properties. If not, 'type' (class name) is required to create it. " +
      "For TileSets, use tileset_create instead (handles atlas + physics setup).",
    inputSchema: {
      file_path: z.string(),
      properties: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          "Property values. Sub-resources in dicts: use {type:'NewResource', class:'ClassName', properties:{...}}.",
        ),
      type: z.string().optional().describe("Resource class name. Required when creating a new resource."),
    },
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false, destructiveHint: false },
    successHint: "Verify with resource_load. Assign to node via node_set_property with Resource type tag.",
    pathParams: [PROJECT_FILE_PATH],
  },
  {
    name: "resource_delete",
    method: "resource.delete",
    description:
      "Delete the .tres/.res and its .uid companion at file_path. No active-use guard (Godot refs survive file deletion; detect orphans via editor_get_console).",
    inputSchema: { file_path: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    successHint: "For scenes use scene_delete. For scripts use script_delete. Non-resource files: file_delete.",
    pathParams: [PROJECT_FILE_PATH],
  },
];

// resource_load `properties` is already <untrusted>-wrapped at origin by the
// toolkit (resource_commands.gd wraps the whole JSON.stringify(properties) in
// one envelope). Do NOT re-wrap here: the wrapper scrubs inner envelope tags,
// so double-wrapping corrupts the envelope. See ADR 0009 (toolkit).
export function register(server: McpServer, bridge: Bridge, allowedTools: Set<string> | null = null): void {
  registerTools(server, bridge, resourceTools, allowedTools);
}
