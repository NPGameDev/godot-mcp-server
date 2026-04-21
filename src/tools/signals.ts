import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../types.js";
import { callAndWrap } from "../types.js";

// signal_emit is dual-mode: default routes to the editor-side Mode A
// server (edited scene); `mode: "runtime"` routes to Mode B for
// emitting on live nodes. list / manage are editor-only.

export const signalTools: ToolDef[] = [
  {
    name: "signal_list",
    method: "signal.list",
    description: "List signals on a node in the edited scene. Returns [{ name, args: [{name, type}] }] from get_signal_list().",
    inputSchema: { node_path: z.string() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "signal_manage",
    method: "signal.manage",
    description: "Connect or disconnect a signal in the edited scene. action='connect' is UndoRedo-wrapped and idempotent (status 'returned' on collision).",
    inputSchema: {
      action: z.enum(["connect", "disconnect"]),
      source_path: z.string(),
      signal_name: z.string(),
      target_path: z.string(),
      method_name: z.string(),
    },
    annotations: { idempotentHint: true, openWorldHint: false },
  },
  {
    name: "signal_emit",
    method: "signal.emit",
    description: "Emit signal_name on node with optional args. mode='editor' (default, edited scene) or mode='runtime' (live game, Mode B).",
    inputSchema: {
      node_path: z.string(),
      signal_name: z.string(),
      args: z.array(z.unknown()).optional(),
      mode: z.enum(["editor", "runtime"]).optional(),
    },
    annotations: { openWorldHint: false },
  },
];

export function register(server: McpServer, bridge: Bridge, allowedTools: Set<string> | null = null): void {
  for (const tool of signalTools) {
    if (allowedTools && !allowedTools.has(tool.name)) continue;
    if (tool.name === "signal_emit") {
      server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: tool.annotations,
        },
        (input: unknown) => {
          const parsed = input as { node_path: string; signal_name: string; args?: unknown[]; mode?: "editor" | "runtime" };
          const mode = parsed.mode ?? "editor";
          const params = { node_path: parsed.node_path, signal_name: parsed.signal_name, args: parsed.args ?? [] };
          return callAndWrap(bridge, tool.method, params, { runtime: mode === "runtime" });
        },
      );
    } else {
      server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: tool.annotations,
        },
        (input: unknown) => callAndWrap(bridge, tool.method, input),
      );
    }
  }
}
