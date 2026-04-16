import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Bridge, Profile, callAndWrap, includesInProfile } from "../types.js";
import { ToolDef } from "./scene.js";

export const folderTools: ToolDef[] = [
  {
    name: "folder_create",
    method: "folder.create",
    description:
      "Create directory at res:// path (recursive — parents auto-created). Idempotent: status created on fresh, returned if pre-existing.",
    inputSchema: { path: z.string() },
  },
  {
    name: "folder_delete",
    method: "folder.delete",
    description:
      "Delete directory. recursive:false(default) requires empty. Refuses project root, addons, and folders containing open scenes/scripts (PATH_IN_USE).",
    inputSchema: {
      path: z.string(),
      recursive: z.boolean().optional(),
    },
  },
];

export function register(server: McpServer, bridge: Bridge, profile: Profile = "full"): void {
  for (const tool of folderTools) {
    if (!includesInProfile(tool.name, profile)) continue;
    // TODO(iter-18): path sanitisation. folder.create auto-creates
    // intermediates so FileGuard's escape-rejection matters especially here.
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      (input: unknown) => callAndWrap(bridge, tool.method, input),
    );
  }
}
