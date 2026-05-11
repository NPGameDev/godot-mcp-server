import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../types.js";
import { registerTools, coercedBoolean, jsonCoerce } from "../tool_helpers.js";

// signal_emit is dual-mode: default routes to the editor-side Mode A
// server (edited scene); `mode: "runtime"` routes to Mode B for
// emitting on live nodes. list / manage are editor-only.

export const signalTools: ToolDef[] = [
  {
    name: "signal_list",
    method: "signal.list",
    description:
      "List signals on a node in the edited scene. With include_connections=true, each signal includes its connected targets ({target_path, method_name, flags}).",
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
      "Connect or disconnect a signal in the edited scene. action='connect' is UndoRedo-wrapped and idempotent (status 'returned' on collision).",
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
    description:
      "Emit signal_name on node with optional args. mode='editor' (default, edited scene) or mode='runtime' (live game, Mode B).",
    inputSchema: {
      node_path: z.string(),
      signal_name: z.string(),
      args: z.preprocess(jsonCoerce, z.array(z.unknown())).optional(),
      mode: z.enum(["editor", "runtime"]).optional(),
    },
    annotations: { openWorldHint: false },
  },
];

// NOTE: All signal tools are in the "signals" group (GROUP_TOOL_NAMES).
// The dual-mode signal_emit handler lives in groups.ts createHandler.
// This register() is a no-op under standard/custom profiles but remains
// as a fallback for direct-call scenarios.
export function register(server: McpServer, bridge: Bridge, allowedTools: Set<string> | null = null): void {
  registerTools(server, bridge, signalTools, allowedTools);
}
