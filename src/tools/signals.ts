import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../shared/types.js";
import { registerTools } from "../registration/toolRegistry.js";
import { coercedBoolean, jsonCoerce } from "../shared/schemaCoercion.js";

// signal_emit selects its channel: default routes to the editor-side
// edited scene; `channel: "runtime"` routes to the running game for
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
    operationParam: "action",
  },
  {
    name: "signal_emit",
    method: "signal.emit",
    description:
      "Emit signal_name on node with optional args. channel='editor' (default, edited scene) or channel='runtime' (the running game).",
    inputSchema: {
      node_path: z.string(),
      signal_name: z.string(),
      args: z.preprocess(jsonCoerce, z.array(z.unknown())).optional(),
      // "game" is accepted as a hidden alias for "runtime" (mapped before the
      // enum, not advertised) — z.toJSONSchema surfaces only the inner enum.
      channel: z.preprocess((v) => (v === "game" ? "runtime" : v), z.enum(["editor", "runtime"])).optional(),
    },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
  },
];

// NOTE: All signal tools are in the "signals" group (GROUP_TOOL_NAMES), so the
// group's activation path (groupActivation → createGroupToolHandler) builds the
// channel-routed signal_emit handler. This register() is unused on that path but
// remains as a fallback for direct-call scenarios.
export function register(server: McpServer, bridge: Bridge, allowedTools?: Set<string>): void {
  registerTools(server, bridge, signalTools, allowedTools);
}
