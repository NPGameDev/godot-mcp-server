import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../types.js";
import { registerTools } from "../tool_helpers.js";

// save.* tools access user:// paths filtered by the plugin-side whitelist
// at addons/godot_mcp_toolkit/user_scope_whitelist.json.
export const saveTools: ToolDef[] = [
  {
    name: "save_read",
    method: "save.read",
    description:
      "Read whitelisted user:// file (default 64 KB cap; max 256 KB). Returns UTF-8 content in <untrusted> envelope, or base64 if non-UTF-8. USER_SCOPE_DISABLED if whitelist missing.",
    inputSchema: {
      path: z.string(),
      max_bytes: z.coerce.number().int().positive().max(262144).optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "save_write",
    method: "save.write",
    description:
      "Write to whitelisted user:// file (default whitelist: saves/ prefix). Paths validated by user_scope_whitelist.json. Not idempotent. Creates parent dirs.",
    inputSchema: {
      path: z.string(),
      content: z.string(),
    },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
  },
  {
    name: "save_delete",
    method: "save.delete",
    description:
      "Delete whitelisted user:// file. NOT_FOUND if missing. Delete paths configured in user_scope_whitelist.json.",
    inputSchema: {
      path: z.string(),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  },
  {
    name: "save_list",
    method: "save.list",
    description:
      "List files + subdirs in a whitelisted user:// directory (path must end /). Names only — agent issues follow-up save.list for recursion.",
    inputSchema: {
      path: z.string(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];

export function register(server: McpServer, bridge: Bridge, allowedTools: Set<string> | null = null): void {
  registerTools(server, bridge, saveTools, allowedTools);
}
