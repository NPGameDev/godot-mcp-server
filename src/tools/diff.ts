import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../types.js";
import { callAndWrap } from "../types.js";

// Line-based JSON diff between two scene-tree snapshots. Useful for
// "what changed since I last looked?" workflows after a sequence of
// mutations. The plugin does the heavy lifting; this module is a thin
// pass-through.

export const diffTools: ToolDef[] = [
  {
    name: "scene_diff",
    method: "scene.diff",
    description:
      "Compare a prior scene-tree snapshot against another snapshot (or current edited scene if 'after' omitted). Returns { changed, diff, added, removed }.",
    inputSchema: { before: z.any(), after: z.any().optional() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];

export function register(server: McpServer, bridge: Bridge, allowedTools: Set<string> | null = null): void {
  for (const tool of diffTools) {
    if (allowedTools && !allowedTools.has(tool.name)) continue;
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
