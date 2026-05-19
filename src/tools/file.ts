import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../types.js";
import { registerTools } from "../tool_helpers.js";

export const fileTools: ToolDef[] = [
  {
    name: "file_delete",
    method: "file.delete",
    description:
      "Delete any file under res:// and its .import companion. Auto-closes .tscn/.scn editor tabs on 4.5+ (tab_closed:true). Use for assets not covered by scene/script/resource.delete.",
    inputSchema: {
      file_path: z.string(),
    },
    annotations: { destructiveHint: true, openWorldHint: false },
  },
];

// TODO(security): path sanitisation via FileGuard.
export function register(server: McpServer, bridge: Bridge, allowedTools: Set<string> | null = null): void {
  registerTools(server, bridge, fileTools, allowedTools);
}
