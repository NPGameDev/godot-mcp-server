import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, Profile, ToolDef } from "../types.js";
import { callAndWrap } from "../types.js";

export const scriptTools: ToolDef[] = [
  {
    name: "script_read",
    tier: "lite",
    method: "script.read",
    description: "Read a GDScript file (res:// only). Returns the file content as text.",
    inputSchema: { path: z.string() },
  },
  {
    name: "script_write",
    tier: "lite",
    method: "script.write",
    description: "Write .gd/.cs/.gdshader/.gdshaderinc at path (res:// only, creates or overwrites). Not idempotent. Use script.delete to remove; resource.create for .tres; scene.create for .tscn.",
    inputSchema: { path: z.string(), content: z.string() },
  },
  {
    name: "script_delete",
    tier: "full",
    method: "script.delete",
    description:
      "Delete .gd/.cs/.gdshader/.gdshaderinc at path (and .uid companion). Refuses non-script paths (INVALID_PATH). No open-in-editor guard.",
    inputSchema: { path: z.string() },
  },
];

export function register(server: McpServer, bridge: Bridge, profile: Profile = "full"): void {
  for (const tool of scriptTools) {
    if (profile === "lite" && tool.tier !== "lite") continue;
    // TODO(security): for script_read, wrap result.content in
    // <untrusted kind="gdscript" source="godot">...</untrusted> before returning.
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      (input: unknown) => callAndWrap(bridge, tool.method, input),
    );
  }
}
