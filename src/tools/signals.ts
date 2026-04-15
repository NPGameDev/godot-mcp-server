import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Bridge, callAndWrap } from "../types.js";
import { ToolDef } from "./scene.js";

// Signal tools (iter 11). signal_emit is dual-mode: default routes to the
// editor-side Mode A server (edited scene); `mode: "runtime"` routes to
// Mode B for emitting on live nodes. list / connect / disconnect are
// editor-only — runtime-side mirrors exist on port 9090 but the MCP tool
// layer doesn't expose them separately for iter 11. (If needed, add
// `mode` to those three in a follow-up.)

export const signalTools: ToolDef[] = [
  {
    name: "signal_list",
    method: "signal.list",
    description: "List signals on a node in the edited scene. Returns [{ name, args: [{name, type}] }] from get_signal_list().",
    inputSchema: { path: z.string() },
  },
  {
    name: "signal_connect",
    method: "signal.connect",
    description: "Connect source.signal -> target.method in edited scene. UndoRedo-wrapped, idempotent (ALREADY_EXISTS on repeat).",
    inputSchema: {
      source_path: z.string(),
      signal: z.string(),
      target_path: z.string(),
      method: z.string(),
    },
  },
  {
    name: "signal_disconnect",
    method: "signal.disconnect",
    description: "Disconnect source.signal -> target.method in edited scene. UndoRedo-wrapped. Returns NOT_FOUND if no such connection.",
    inputSchema: {
      source_path: z.string(),
      signal: z.string(),
      target_path: z.string(),
      method: z.string(),
    },
  },
  {
    name: "signal_emit",
    method: "signal.emit",
    description: "Emit signal on node with optional args. mode='editor' (default, edited scene) or mode='runtime' (live game, Mode B).",
    inputSchema: {
      path: z.string(),
      signal: z.string(),
      args: z.array(z.unknown()).optional(),
      mode: z.enum(["editor", "runtime"]).optional(),
    },
  },
];

export function register(server: McpServer, bridge: Bridge): void {
  for (const tool of signalTools) {
    if (tool.name === "signal_emit") {
      server.registerTool(
        tool.name,
        { description: tool.description, inputSchema: tool.inputSchema },
        (input: unknown) => {
          const parsed = input as { path: string; signal: string; args?: unknown[]; mode?: "editor" | "runtime" };
          const mode = parsed.mode ?? "editor";
          const params = { path: parsed.path, signal: parsed.signal, args: parsed.args ?? [] };
          return callAndWrap(bridge, tool.method, params, { runtime: mode === "runtime" });
        },
      );
    } else {
      server.registerTool(
        tool.name,
        { description: tool.description, inputSchema: tool.inputSchema },
        (input: unknown) => callAndWrap(bridge, tool.method, input),
      );
    }
  }
}
