import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, Profile, ToolDef } from "../types.js";
import { callAndWrap } from "../types.js";

export const fileTools: ToolDef[] = [
  {
    name: "file_delete",
    tier: "full",
    method: "file.delete",
    description:
      "Delete any file under res:// and its .import companion. Use for assets (.png, .wav, .glb, etc.) not covered by scene/script/resource.delete.",
    inputSchema: {
      file_path: z.string(),
    },
  },
];

export function register(server: McpServer, bridge: Bridge, profile: Profile = "full"): void {
  for (const tool of fileTools) {
    if (profile === "lite" && tool.tier !== "lite") continue;
    // TODO(security): path sanitisation via FileGuard.
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      (input: unknown) => callAndWrap(bridge, tool.method, input),
    );
  }
}
