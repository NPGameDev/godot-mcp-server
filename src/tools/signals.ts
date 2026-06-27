import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../types.js";
import { registerTools } from "../tool_registry.js";
import { coercedBoolean, jsonCoerce } from "../schema_coercion.js";

// signal_emit is dual-mode: default routes to the editor-side Mode A
// server (edited scene); `mode: "runtime"` routes to Mode B for
// emitting on live nodes. list / manage are editor-only.

export const signalTools: ToolDef[] = [
  {
    name: "signal_list",
    method: "signal.list",
    description:
      "List signals on a node. include_connections=true adds targets ({target_path, method_name, flags}). flags & 2 = CONNECT_PERSIST (saved in .tscn).",
    inputSchema: {
      node_path: z.string(),
      include_connections: coercedBoolean().optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "signal_manage",
    method: "signal.manage",
    description:
      "Connect or disconnect a signal (editor-time, CONNECT_PERSIST — saved in .tscn, survives save/load). Idempotent connect (status 'returned' on collision).",
    inputSchema: {
      action: z.enum(["connect", "disconnect"]),
      node_path: z.string(),
      signal_name: z.string(),
      target_path: z.string(),
      method_name: z.string(),
    },
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false, destructiveHint: false },
  },
  {
    name: "signal_emit",
    method: "signal.emit",
    description:
      "Emit signal_name on node with optional args. mode='editor' (default, edited scene) or mode='runtime' (live game, Mode B).",
    inputSchema: {
      node_path: z.string(),
      signal_name: z.string(),
      args: z.preprocess(jsonCoerce, z.array(z.unknown())).optional(),
      mode: z.enum(["editor", "runtime"]).optional(),
    },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
  },
];

// NOTE: All signal tools are in the "signals" group (GROUP_TOOL_NAMES).
// The dual-mode signal_emit handler is built by group_tool_handlers.ts (createHandler).
// This register() is a no-op under standard/custom profiles but remains
// as a fallback for direct-call scenarios.
export function register(server: McpServer, bridge: Bridge, allowedTools: Set<string> | null = null): void {
  registerTools(server, bridge, signalTools, allowedTools);
}
