import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../types.js";
import { registerTools } from "../tool_helpers.js";

export const resourceTools: ToolDef[] = [
  {
    name: "resource_load",
    method: "resource.load",
    description:
      "Load a res:// resource and return { class, path, properties, metadata }. Heavy fields (image, mesh_arrays) pruned; Texture2D gets size in metadata.",
    inputSchema: { file_path: z.string() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "resource_write",
    method: "resource.write",
    description:
      "Write/create a .tres/.res resource. If file exists, updates properties. If not, 'type' (class name) is required to create it.",
    inputSchema: {
      file_path: z.string(),
      properties: z.record(z.string(), z.unknown()).optional(),
      type: z.string().optional().describe("Resource class name. Required when creating a new resource."),
    },
    annotations: { idempotentHint: true, openWorldHint: false },
  },
  {
    name: "resource_delete",
    method: "resource.delete",
    description:
      "Delete the .tres/.res and its .uid companion at file_path. No active-use guard (Godot refs survive file deletion; detect orphans via editor_get_errors).",
    inputSchema: { file_path: z.string() },
    annotations: { destructiveHint: true, openWorldHint: false },
  },
];

// TODO(security): wrap `properties` in an <untrusted kind="resource_props">
// envelope if the underlying data came from disk.
export function register(server: McpServer, bridge: Bridge, allowedTools: Set<string> | null = null): void {
  registerTools(server, bridge, resourceTools, allowedTools);
}
