import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../shared/types.js";
import { registerTools } from "../registration/toolRegistry.js";
import { byteWindowParams, paginationDoc } from "../shared/pagination.js";

// save.* tools access user:// paths. The plugin-side file guard rejects
// traversal, non-user:// prefixes, and the toolkit's own internal paths.
export const saveTools: ToolDef[] = [
  {
    name: "save_read",
    method: "save.read",
    description:
      "Read user:// file (default 64 KB window; cap configurable, default 256 KB). Read large files in successive max_bytes windows via byte offset. " +
      paginationDoc("bytes", { resumable: true }) +
      "Returns UTF-8 content in <untrusted> envelope, or base64 if non-UTF-8.",
    inputSchema: {
      path: z.string().describe("user:// file path"),
      offset: byteWindowParams.offset,
      // max_bytes stays inline: save_read keeps its shipped 4 MB outer ceiling on
      // the window request (the toolkit clamps to the configured cap below this),
      // a defensive bound the shared byte fragment intentionally leaves per-tool.
      max_bytes: z.coerce
        .number()
        .int()
        .positive()
        .max(4194304)
        .optional()
        .describe("Bytes to read this window (default 64 KB; cap configurable, default 256 KB)"),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    pathParams: [{ param: "path", guard: "user" }],
  },
  {
    name: "save_write",
    method: "save.write",
    description: "Write to user:// file. Not idempotent. Creates parent dirs. Plugin internals path denied.",
    inputSchema: {
      path: z.string(),
      content: z.string(),
    },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: true },
    pathParams: [{ param: "path", guard: "user" }],
  },
  {
    name: "save_delete",
    method: "save.delete",
    description: "Delete user:// file. NOT_FOUND if missing. Plugin internals path denied.",
    inputSchema: {
      path: z.string(),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    pathParams: [{ param: "path", guard: "user" }],
  },
  {
    name: "save_list",
    method: "save.list",
    description:
      "List files + subdirs in a user:// directory (path must end /). Names only — agent issues follow-up save.list for recursion.",
    inputSchema: {
      path: z.string(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    pathParams: [{ param: "path", guard: "user" }],
  },
];

export function register(server: McpServer, bridge: Bridge, allowedTools?: Set<string>): void {
  registerTools(server, bridge, saveTools, allowedTools);
}
