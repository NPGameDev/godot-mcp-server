import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../types.js";
import { registerTools } from "../tool_registry.js";
import { coercedBoolean } from "../schema_coercion.js";

export const folderTools: ToolDef[] = [
  {
    name: "folder_create",
    method: "folder.create",
    description:
      "Create directory at res:// path (recursive — parents auto-created). Idempotent: status created on fresh, returned if pre-existing.",
    inputSchema: { folder_path: z.string() },
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false, destructiveHint: false },
    pathParams: [{ param: "folder_path", guard: "project" }],
  },
  {
    name: "folder_delete",
    method: "folder.delete",
    description:
      "Delete directory. recursive:false(default) requires empty. On 4.5+ closes one open scene tab; multiple in stale_tabs - use scene_close. Refuses project root, addons, open scripts (PATH_IN_USE).",
    inputSchema: {
      folder_path: z.string(),
      recursive: coercedBoolean().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    pathParams: [{ param: "folder_path", guard: "project" }],
  },
];

export function register(server: McpServer, bridge: Bridge, allowedTools: Set<string> | null = null): void {
  registerTools(server, bridge, folderTools, allowedTools);
}
