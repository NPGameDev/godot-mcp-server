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
    inputSchema: { file_path: z.string() },
  },
  {
    name: "script_write",
    tier: "lite",
    method: "script.write",
    description: "Write .gd/.cs/.gdshader/.gdshaderinc at file_path (res:// only, creates or overwrites). Not idempotent. Use script.delete to remove; resource.create for .tres; scene.create for .tscn.",
    inputSchema: { file_path: z.string(), content: z.string() },
  },
  {
    name: "script_read_range",
    tier: "lite",
    method: "script.read_range",
    description:
      "Read lines [start_line, end_line] (1-indexed, inclusive) from a script file (res:// only). Use when script_read returns FILE_TOO_LARGE.",
    inputSchema: { file_path: z.string(), start_line: z.number(), end_line: z.number() },
  },
  {
    name: "script_delete",
    tier: "full",
    method: "script.delete",
    description:
      "Delete .gd/.cs/.gdshader/.gdshaderinc at file_path (and .uid companion). Refuses non-script paths (INVALID_PATH). No open-in-editor guard.",
    inputSchema: { file_path: z.string() },
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
