import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Bridge, Profile, callAndWrap, includesInProfile } from "../types.js";
import { ToolDef } from "./scene.js";

// scene_diff (iter 12) — line-based JSON diff between two scene-tree
// snapshots. Useful for "what changed since I last looked?" workflows
// after a sequence of mutations. The plugin (mcp_server.gd) does the
// heavy lifting; this module is a thin pass-through. Structural diff is
// post-MVP; the current implementation is symmetric line difference of
// pretty-printed JSON.

export const diffTools: ToolDef[] = [
  {
    name: "scene_diff",
    method: "scene.diff",
    description: "Compare a prior scene-tree snapshot against another snapshot (or current edited scene if 'after' omitted). Returns { changed, diff, added, removed }.",
    inputSchema: { before: z.any(), after: z.any().optional() },
  },
];

export function register(server: McpServer, bridge: Bridge, profile: Profile = "full"): void {
  for (const tool of diffTools) {
    if (!includesInProfile(tool.name, profile)) continue;
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      (input: unknown) => callAndWrap(bridge, tool.method, input),
    );
  }
}
