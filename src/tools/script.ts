import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../shared/types.js";
import { registerTools } from "../registration/toolRegistry.js";
import { PROJECT_FILE_PATH } from "../security/pathGuard.js";
import { lineWindowParams, paginationDoc } from "../shared/pagination.js";
import { describeScriptCheck } from "./descriptions/scriptCheckDescription.js";

export const scriptTools: ToolDef[] = [
  {
    name: "script_read",
    method: "script.read",
    description:
      "Read a script file (res:// only). Returns the file content as text in an <untrusted> envelope. Read large scripts in successive line windows via start_line/end_line (1-indexed, inclusive). " +
      paginationDoc("lines", { resumable: true }),
    inputSchema: {
      file_path: z.string(),
      ...lineWindowParams,
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
    name: "script_edit",
    method: "script.edit",
    description:
      "Surgically replace a span in an existing .gd/.cs/.gdshader/.gdshaderinc file (res:// only) — the MCP analogue of the native Edit tool. " +
      "old_string must match the file byte-for-byte (whitespace and indentation included); no regex, no fuzzy match. " +
      "old_string not found -> NOT_FOUND; matches more than once without replace_all -> NOT_UNIQUE. " +
      "new_string:'' deletes the span. replace_all replaces every occurrence and returns replacements:N. " +
      "edits applies several edits in order in one call, writing nothing if any fails. " +
      "Prefer this over rewriting the whole file with script_write for a small change — it keeps the editor undo entry, reindexing, and inline diagnostics. " +
      "For .gd files, returns inline diagnostics (valid: bool, diagnostics: [...]) — check valid before proceeding.",
    inputSchema: {
      file_path: z.string(),
      old_string: z
        .string()
        .optional()
        .describe("exact byte-for-byte span to replace (whitespace/indent must match); omit when passing edits"),
      new_string: z
        .string()
        .optional()
        .describe("replacement text; empty string deletes the span; omit when passing edits"),
      replace_all: z
        .boolean()
        .optional()
        .describe("replace every occurrence instead of requiring a unique match (default false)"),
      edits: z
        .array(
          z.object({
            old_string: z.string(),
            new_string: z.string(),
            replace_all: z.boolean().optional(),
          }),
        )
        .min(1)
        .optional()
        .describe(
          "several edits in one call, instead of old_string/new_string/replace_all; each applies to the text the earlier ones leave, and nothing is written if any fails",
        ),
    },
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
    description: describeScriptCheck(null),
    describe: describeScriptCheck,
    inputSchema: { file_path: z.string().describe("res:// path to a .gd file") },
    annotations: { readOnlyHint: true, openWorldHint: false },
    successHint:
      "For detailed diagnostics on this file use lsp_diagnostics; to check whether the change broke another script, use lsp_project_diagnostics (whole-project scan). For runtime errors use editor_get_console.",
    pathParams: [PROJECT_FILE_PATH],
  },
];

// script_read content is already <untrusted>-wrapped at origin by the toolkit
// (script_commands.gd). Do NOT re-wrap here: the wrapper scrubs inner envelope
// tags, so double-wrapping corrupts the envelope.
export function register(server: McpServer, bridge: Bridge, allowedTools?: Set<string>): void {
  registerTools(server, bridge, scriptTools, allowedTools);
}
