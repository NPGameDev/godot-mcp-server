import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, Profile, ToolDef } from "../types.js";
import { callAndWrap } from "../types.js";

// Line-based JSON diff between two scene-tree snapshots. Useful for
// "what changed since I last looked?" workflows after a sequence of
// mutations. The plugin does the heavy lifting; this module is a thin
// pass-through.

export const diffTools: ToolDef[] = [
  {
    name: "scene_diff",
    tier: "full",
    method: "scene.diff",
    description: "Compare a prior scene-tree snapshot against another snapshot (or current edited scene if 'after' omitted). Returns { changed, diff, added, removed }.",
    inputSchema: { before: z.any(), after: z.any().optional() },
  },
];

export function register(server: McpServer, bridge: Bridge, profile: Profile = "full"): void {
  for (const tool of diffTools) {
    if (profile === "lite" && tool.tier !== "lite") continue;
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      (input: unknown) => callAndWrap(bridge, tool.method, input),
    );
  }
}
