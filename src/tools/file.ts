import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../types.js";
import { callAndWrap } from "../types.js";

export const fileTools: ToolDef[] = [
  {
    name: "file_delete",
    method: "file.delete",
    description:
      "Delete any file under res:// and its .import companion. Use for assets (.png, .wav, .glb, etc.) not covered by scene/script/resource.delete.",
    inputSchema: {
      file_path: z.string(),
    },
    annotations: { destructiveHint: true, openWorldHint: false },
  },
];

export function register(server: McpServer, bridge: Bridge, allowedTools: Set<string> | null = null): void {
  for (const tool of fileTools) {
    if (allowedTools && !allowedTools.has(tool.name)) continue;
    // TODO(security): path sanitisation via FileGuard.
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
