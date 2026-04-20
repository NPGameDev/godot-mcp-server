import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../types.js";
import { callAndWrap } from "../types.js";

export const folderTools: ToolDef[] = [
  {
    name: "folder_create",
    tier: "full",
    method: "folder.create",
    description:
      "Create directory at res:// path (recursive — parents auto-created). Idempotent: status created on fresh, returned if pre-existing.",
    inputSchema: { folder_path: z.string() },
    annotations: { idempotentHint: true, openWorldHint: false },
  },
  {
    name: "folder_delete",
    tier: "full",
    method: "folder.delete",
    description:
      "Delete directory. recursive:false(default) requires empty. Refuses project root, addons, and folders containing open scenes/scripts (PATH_IN_USE).",
    inputSchema: {
      folder_path: z.string(),
      recursive: z.boolean().optional(),
    },
    annotations: { destructiveHint: true, openWorldHint: false },
  },
];

export function register(server: McpServer, bridge: Bridge, allowedTools: Set<string> | null = null): void {
  for (const tool of folderTools) {
    if (allowedTools && !allowedTools.has(tool.name)) continue;
    // TODO(security): path sanitisation. folder.create auto-creates
    // intermediates so FileGuard's escape-rejection matters especially here.
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
