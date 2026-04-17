import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Bridge, Profile, callAndWrap, includesInProfile } from "../types.js";
import { ToolDef } from "./scene.js";

export const fileTools: ToolDef[] = [
  {
    name: "file_delete",
    method: "file.delete",
    description:
      "Delete any file under res:// and its .import companion. Use for assets (.png, .wav, .glb, etc.) not covered by scene/script/resource.delete.",
    inputSchema: {
      path: z.string(),
    },
  },
];

export function register(server: McpServer, bridge: Bridge, profile: Profile = "full"): void {
  for (const tool of fileTools) {
    if (!includesInProfile(tool.name, profile)) continue;
    // TODO(iter-18): path sanitisation via FileGuard.
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      (input: unknown) => callAndWrap(bridge, tool.method, input),
    );
  }
}
