import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Bridge } from "../types.js";
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

export function register(server: McpServer, bridge: Bridge): void {
  for (const tool of diffTools) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      async (input: unknown) => {
        const result = await bridge.call(tool.method, input);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      },
    );
  }
}
