import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Bridge, BridgeError } from "../types.js";
import { ToolDef } from "./scene.js";

// Mode B — tools that talk to the game-side runtime autoload on
// 127.0.0.1:9090. Only works while the game is running in a debug build
// (release exports never ship the autoload). Bridge.callRuntime maps the
// connect failure to GAME_NOT_RUNNING for us.

export const runtimeTools: ToolDef[] = [
  {
    name: "runtime_screenshot",
    method: "runtime.screenshot",
    description: "Capture a frame from the running game's main viewport (Mode B, debug build). Returns inline PNG image content.",
    inputSchema: {},
  },
  {
    name: "runtime_get_node_state",
    method: "runtime.get_node_state",
    description: "Inspect a live node at path in the running game: returns { name, class, path, properties } (inspector-visible fields only).",
    inputSchema: { path: z.string() },
  },
  {
    name: "debugger_get_log",
    method: "debugger.get_log",
    description: "Return recent lines from the running game's log file (user://logs/godot.log). Optional limit (default 200).",
    inputSchema: { limit: z.number().int().positive().optional() },
  },
];

type TextResult = { content: { type: "text"; text: string }[]; isError?: boolean };
type ImageOrErrorResult =
  | { content: ({ type: "image"; data: string; mimeType: string } | { type: "text"; text: string })[] }
  | TextResult;

function runtimeErrorResult(err: unknown): TextResult {
  const code = err instanceof BridgeError ? err.code : "INTERNAL";
  const message = (err as Error)?.message ?? String(err);
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: message, code }) }],
    isError: true,
  };
}

export function register(server: McpServer, bridge: Bridge): void {
  for (const tool of runtimeTools) {
    if (tool.name === "runtime_screenshot") {
      server.registerTool(
        tool.name,
        { description: tool.description, inputSchema: tool.inputSchema },
        async () => {
          let result: {
            image_base64?: string;
            mime_type?: string;
            width?: number;
            height?: number;
            bytes?: number;
            code?: string;
            error?: string;
          };
          try {
            result = (await bridge.callRuntime(tool.method, {})) as typeof result;
          } catch (err) {
            return runtimeErrorResult(err) satisfies ImageOrErrorResult;
          }
          if (result?.code || !result?.image_base64) {
            return {
              content: [{ type: "text" as const, text: JSON.stringify(result) }],
              isError: true,
            } satisfies ImageOrErrorResult;
          }
          return {
            content: [
              { type: "image" as const, data: result.image_base64, mimeType: result.mime_type ?? "image/png" },
              { type: "text" as const, text: JSON.stringify({ width: result.width, height: result.height, bytes: result.bytes }) },
            ],
          } satisfies ImageOrErrorResult;
        },
      );
    } else {
      server.registerTool(
        tool.name,
        { description: tool.description, inputSchema: tool.inputSchema },
        async (input: unknown) => {
          try {
            const result = await bridge.callRuntime(tool.method, input);
            // TODO(iter-18): wrap debugger_get_log's `lines` array in an
            // <untrusted kind="game_log" source="godot"> envelope before
            // returning. Do not envelope runtime_get_node_state — it's
            // structured property data, not free-form text.
            return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
          } catch (err) {
            return runtimeErrorResult(err);
          }
        },
      );
    }
  }
}
