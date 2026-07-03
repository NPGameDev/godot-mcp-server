import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../shared/types.js";
import { registerTools } from "../registration/toolRegistry.js";
import { PROJECT_FILE_PATH } from "../security/pathGuard.js";

export const scriptTools: ToolDef[] = [
  {
    name: "script_read",
    method: "script.read",
    description:
      "Read a script file (res:// only). Returns the file content as text in an <untrusted> envelope. Read large scripts in successive line windows via start_line/end_line (1-indexed, inclusive); the response carries next_start_line/total_lines/truncated to drive paging — pass next_start_line back as start_line until truncated is false.",
    inputSchema: {
      file_path: z.string(),
      start_line: z.coerce
        .number()
        .int()
        .positive()
        .optional()
        .describe("1-based first line to read (default 1); pass next_start_line from the prior response to page"),
      end_line: z.coerce.number().int().positive().optional().describe("1-based last line to read (inclusive)"),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    pathParams: [PROJECT_FILE_PATH],
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
    successHint:
      "Validate .gd with script_check (offline) or lsp_diagnostics. Shaders (.gdshader/.gdshaderinc) have no offline validator — neither script_check nor lsp_diagnostics check them; shader errors surface when the editor imports/compiles the shader (open it, or run the game), via editor_get_console (level_filter:['error']).",
    pathParams: [PROJECT_FILE_PATH],
  },
  {
    name: "script_delete",
    method: "script.delete",
    description:
      "Delete .gd/.cs/.gdshader/.gdshaderinc at file_path (and .uid companion). Refuses non-script paths (INVALID_PATH). No open-in-editor guard.",
    inputSchema: { file_path: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    successHint: "For scenes use scene_delete. For resources use resource_delete.",
    pathParams: [PROJECT_FILE_PATH],
  },
  {
    name: "script_check",
    method: "script.check",
    description:
      "Lightweight offline GDScript validation — pass/fail; for line-level detail use editor_get_console (4.5+) or lsp_diagnostics. Works without editor.",
    inputSchema: { file_path: z.string().describe("res:// path to a .gd file") },
    annotations: { readOnlyHint: true, openWorldHint: false },
    successHint: "For detailed diagnostics use lsp_diagnostics. For runtime errors use editor_get_console.",
    pathParams: [PROJECT_FILE_PATH],
  },
];

// script_read content is already <untrusted>-wrapped at origin by the toolkit
// (script_commands.gd). Do NOT re-wrap here: the wrapper scrubs inner envelope
// tags, so double-wrapping corrupts the envelope.
export function register(server: McpServer, bridge: Bridge, allowedTools?: Set<string>): void {
  registerTools(server, bridge, scriptTools, allowedTools);
}
