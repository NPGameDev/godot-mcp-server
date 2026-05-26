import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../types.js";
import { registerTools } from "../tool_helpers.js";

export const scriptTools: ToolDef[] = [
  {
    name: "script_read",
    method: "script.read",
    description:
      "Read a script file (res:// only). Returns the file content as text. Pass start_line / end_line for partial reads (1-indexed, inclusive).",
    inputSchema: {
      file_path: z.string(),
      start_line: z.coerce.number().optional().describe("First line to read (1-indexed, inclusive)"),
      end_line: z.coerce.number().optional().describe("Last line to read (1-indexed, inclusive)"),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "script_write",
    method: "script.write",
    description:
      "Write .gd/.cs/.gdshader/.gdshaderinc at file_path (res:// only, creates or overwrites). " +
      "For .gd files, returns inline diagnostics (valid: bool, diagnostics: [...]) — check valid before proceeding. " +
      "Not idempotent. Use script.delete to remove; resource.create for .tres; scene.create for .tscn.",
    inputSchema: { file_path: z.string(), content: z.string() },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
    successHint: "Validate with script_check or lsp_diagnostics. Errors also appear in editor_get_console.",
  },
  {
    name: "script_delete",
    method: "script.delete",
    description:
      "Delete .gd/.cs/.gdshader/.gdshaderinc at file_path (and .uid companion). Refuses non-script paths (INVALID_PATH). No open-in-editor guard.",
    inputSchema: { file_path: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    successHint: "For scenes use scene_delete. For resources use resource_delete.",
  },
  {
    name: "script_check",
    method: "script.check",
    description:
      "Lightweight offline GDScript validation — pass/fail with line-level errors. Works without editor. " +
      "For richer diagnostics, activate lsp_code_analysis group.",
    inputSchema: { file_path: z.string().describe("res:// path to a .gd file") },
    annotations: { readOnlyHint: true, openWorldHint: false },
    successHint: "For detailed diagnostics use lsp_diagnostics. For runtime errors use editor_get_console.",
  },
];

// TODO(security): for script_read, wrap result.content in
// <untrusted kind="gdscript" source="godot">...</untrusted> before returning.
export function register(server: McpServer, bridge: Bridge, allowedTools: Set<string> | null = null): void {
  registerTools(server, bridge, scriptTools, allowedTools);
}
