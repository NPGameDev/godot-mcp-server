import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Bridge, Profile, callAndWrap, includesInProfile } from "../types.js";
import { ToolDef } from "./scene.js";

export const resourceTools: ToolDef[] = [
  {
    name: "resource_load",
    method: "resource.load",
    description: "Load a res:// resource and return { class, path, properties, metadata }. Heavy fields (image, mesh_arrays) pruned; Texture2D gets size in metadata.",
    inputSchema: { path: z.string() },
  },
];

export function register(server: McpServer, bridge: Bridge, profile: Profile = "full"): void {
  for (const tool of resourceTools) {
    if (!includesInProfile(tool.name, profile)) continue;
    // TODO(iter-18): wrap `properties` in an <untrusted kind="resource_props">
    // envelope if the underlying data came from disk. Skip for built-in
    // engine metadata (width/height) — those are trusted engine output.
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      (input: unknown) => callAndWrap(bridge, tool.method, input),
    );
  }
}
