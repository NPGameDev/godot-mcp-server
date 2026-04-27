import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../types.js";
import { registerTools } from "../tool_helpers.js";

export const scriptTools: ToolDef[] = [
  {
    name: "script_read",
    method: "script.read",
    description: "Read a GDScript file (res:// only). Returns the file content as text.",
    inputSchema: { file_path: z.string() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "script_write",
    method: "script.write",
    description:
      "Write .gd/.cs/.gdshader/.gdshaderinc at file_path (res:// only, creates or overwrites). Not idempotent. Use script.delete to remove; resource.create for .tres; scene.create for .tscn.",
    inputSchema: { file_path: z.string(), content: z.string() },
    annotations: { openWorldHint: false },
  },
  {
    name: "script_read_range",
    method: "script.read_range",
    description:
      "Read lines [start_line, end_line] (1-indexed, inclusive) from a script file (res:// only). Use when script_read returns FILE_TOO_LARGE.",
    inputSchema: { file_path: z.string(), start_line: z.number(), end_line: z.number() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "script_delete",
    method: "script.delete",
    description:
      "Delete .gd/.cs/.gdshader/.gdshaderinc at file_path (and .uid companion). Refuses non-script paths (INVALID_PATH). No open-in-editor guard.",
    inputSchema: { file_path: z.string() },
    annotations: { destructiveHint: true, openWorldHint: false },
  },
  {
    name: "script_check",
    method: "script.check",
    description:
      "Validate a GDScript file. Returns structured diagnostics (errors/warnings with line numbers). Read-only — does not modify the script.",
    inputSchema: { file_path: z.string().describe("res:// path to a .gd file") },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];

// TODO(security): for script_read, wrap result.content in
// <untrusted kind="gdscript" source="godot">...</untrusted> before returning.
export function register(server: McpServer, bridge: Bridge, allowedTools: Set<string> | null = null): void {
  registerTools(server, bridge, scriptTools, allowedTools);
}
