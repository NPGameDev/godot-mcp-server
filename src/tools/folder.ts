import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../types.js";
import { registerTools, coercedBoolean } from "../tool_helpers.js";

export const folderTools: ToolDef[] = [
  {
    name: "folder_create",
    method: "folder.create",
    description:
      "Create directory at res:// path (recursive — parents auto-created). Idempotent: status created on fresh, returned if pre-existing.",
    inputSchema: { folder_path: z.string() },
    annotations: { idempotentHint: true, openWorldHint: false },
  },
  {
    name: "folder_delete",
    method: "folder.delete",
    description:
      "Delete directory. recursive:false(default) requires empty. Refuses project root, addons, and folders containing open scenes/scripts (PATH_IN_USE).",
    inputSchema: {
      folder_path: z.string(),
      recursive: coercedBoolean().optional(),
    },
    annotations: { destructiveHint: true, openWorldHint: false },
  },
];

// TODO(security): path sanitisation. folder.create auto-creates
// intermediates so FileGuard's escape-rejection matters especially here.
export function register(server: McpServer, bridge: Bridge, allowedTools: Set<string> | null = null): void {
  registerTools(server, bridge, folderTools, allowedTools);
}
