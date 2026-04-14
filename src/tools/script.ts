import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Bridge } from "../types.js";
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
    description: "Write GDScript file content (res:// only). Overwrites existing files.",
    inputSchema: { path: z.string(), content: z.string() },
  },
];

export function register(server: McpServer, bridge: Bridge): void {
  for (const tool of scriptTools) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      async (input: unknown) => {
        const result = await bridge.call(tool.method, input);
        // TODO(iter-18): for script_read, wrap result.content in
        // <untrusted kind="gdscript" source="godot">...</untrusted> before returning.
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      },
    );
  }
}
