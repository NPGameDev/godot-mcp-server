import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Bridge, Profile, callAndWrap, includesInProfile } from "../types.js";
import { ToolDef } from "./scene.js";

export const assetTools: ToolDef[] = [
  {
    name: "asset_list",
    method: "asset.list",
    description:
      "Enumerate res:// assets with filters (path_prefix, name_glob, class_filter ancestry-aware, extension_filter). Returns [{path,class,modified_unix}]. Cap max_results 2000.",
    inputSchema: {
      path_prefix: z.string().optional(),
      name_glob: z.string().optional(),
      class_filter: z.string().optional(),
      extension_filter: z.array(z.string()).optional(),
      max_results: z.number().optional(),
    },
  },
  {
    name: "asset_get_dependencies",
    method: "asset.get_dependencies",
    description:
      "Forward dependencies of a res:// resource/scene via EditorFileSystem cache. include_transitive walks deps-of-deps. Returns [{path,raw_path,class}].",
    inputSchema: {
      path: z.string(),
      include_transitive: z.boolean().optional(),
      max_results: z.number().optional(),
    },
  },
];

export function register(server: McpServer, bridge: Bridge, profile: Profile = "full"): void {
  for (const tool of assetTools) {
    if (!includesInProfile(tool.name, profile)) continue;
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      (input: unknown) => callAndWrap(bridge, tool.method, input),
    );
  }
}
