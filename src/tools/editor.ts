import { z } from "zod";
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
    description: "Capture a screenshot of the editor viewport. Returns image content inline. Optional save_path (res:// .png) also persists it to disk.",
    inputSchema: { save_path: z.string().optional() },
  },
];

export function register(server: McpServer, bridge: Bridge): void {
  for (const tool of editorTools) {
    if (tool.name === "editor_screenshot") {
      server.registerTool(
        tool.name,
        { description: tool.description, inputSchema: tool.inputSchema },
        async (input: { save_path?: string }) => {
          const result = (await bridge.call(tool.method, input ?? {})) as {
            image_base64?: string;
            mime_type?: string;
            width?: number;
            height?: number;
            bytes?: number;
            path?: string;
            code?: string;
            error?: string;
          };
          if (result?.code || !result?.image_base64) {
            return { content: [{ type: "text" as const, text: JSON.stringify(result) }], isError: true };
          }
          return {
            content: [
              { type: "image" as const, data: result.image_base64, mimeType: result.mime_type ?? "image/png" },
              { type: "text" as const, text: JSON.stringify({ width: result.width, height: result.height, bytes: result.bytes, path: result.path }) },
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
