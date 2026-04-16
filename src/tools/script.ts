import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Bridge, Profile, callAndWrap, includesInProfile } from "../types.js";
import { ToolDef } from "./scene.js";

export const scriptTools: ToolDef[] = [
  {
    name: "script_read",
    method: "script.read",
    description: "Read a GDScript file (res:// only). Returns the file content as text.",
    inputSchema: { path: z.string() },
  },
  {
    name: "script_write",
    method: "script.write",
    description: "Write GDScript file (res:// only). Overwrites existing; integrates with editor UndoRedo so Ctrl-Z restores prior content (or deletes new files).",
    inputSchema: { path: z.string(), content: z.string() },
  },
  {
    name: "script_delete",
    method: "script.delete",
    description:
      "Delete the .gd or .cs script and its .uid companion at path. Refuses non-script paths (code INVALID_PATH) or missing files (NOT_FOUND). No open-in-editor guard.",
    inputSchema: { path: z.string() },
  },
];

export function register(server: McpServer, bridge: Bridge, profile: Profile = "full"): void {
  for (const tool of scriptTools) {
    if (!includesInProfile(tool.name, profile)) continue;
    // TODO(iter-18): for script_read, wrap result.content in
    // <untrusted kind="gdscript" source="godot">...</untrusted> before returning.
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      (input: unknown) => callAndWrap(bridge, tool.method, input),
    );
  }
}
