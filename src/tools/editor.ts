import { z } from "zod";
import { readFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Bridge } from "../types.js";
import { ToolDef } from "./scene.js";

export const editorTools: ToolDef[] = [
  {
    name: "editor_get_errors",
    method: "editor.get_errors",
    description: "Return recent GDScript compile/runtime errors from the editor. (MVP stub; iter 10 replaces with debugger_get_log.)",
    inputSchema: {},
  },
  {
    name: "editor_save_scene",
    method: "editor.save_scene",
    description: "Save the current edited scene. Optional path triggers save-as.",
    inputSchema: { path: z.string().optional() },
  },
  {
    name: "editor_screenshot",
    method: "editor.screenshot",
    description: "Capture a screenshot of the editor viewport. Returns image content inline.",
    inputSchema: {},
  },
];

export function register(server: McpServer, bridge: Bridge): void {
  for (const tool of editorTools) {
    if (tool.name === "editor_screenshot") {
      server.registerTool(
        tool.name,
        { description: tool.description, inputSchema: tool.inputSchema },
        async () => {
          const result = (await bridge.call(tool.method, {})) as {
            absolute_path?: string;
            path?: string;
            width?: number;
            height?: number;
            bytes?: number;
            code?: string;
            error?: string;
          };
          if (result?.code || !result?.absolute_path) {
            return { content: [{ type: "text" as const, text: JSON.stringify(result) }], isError: true };
          }
          const buf = await readFile(result.absolute_path);
          return {
            content: [
              { type: "image" as const, data: buf.toString("base64"), mimeType: "image/png" },
              { type: "text" as const, text: JSON.stringify({ path: result.path, width: result.width, height: result.height, bytes: result.bytes }) },
            ],
          };
        },
      );
    } else {
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
}
