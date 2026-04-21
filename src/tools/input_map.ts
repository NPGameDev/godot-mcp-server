import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../types.js";
import { callAndWrap } from "../types.js";
import { isEnabled } from "../feature_gate.js";

// Both input_map mutators share a single gate (input_map_write).
// Plugin-side FeatureGate performs the full check as defence-in-depth;
// this controls MCP catalogue visibility only.
export const inputMapTools: ToolDef[] = [];

if (isEnabled("input_map_write")) {
  inputMapTools.push(
    {
      name: "input_map_action",
      method: "input_map.action",
      description:
        "Add or remove an InputMap action. action='add' is idempotent with optional deadzone.",
      inputSchema: {
        action: z.enum(["add", "remove"]),
        action_name: z.string(),
        deadzone: z.number().optional(),
      },
      annotations: { idempotentHint: true, openWorldHint: false },
    },
    {
      name: "input_map_event",
      method: "input_map.event",
      description:
        "Bind or unbind an input event to an action. action='bind' is idempotent.",
      inputSchema: {
        action: z.enum(["bind", "unbind"]),
        action_name: z.string(),
        event: z.record(z.string(), z.unknown()),
      },
      annotations: { idempotentHint: true, openWorldHint: false },
    },
  );
}

export function register(server: McpServer, bridge: Bridge, allowedTools: Set<string> | null = null): void {
  for (const tool of inputMapTools) {
    if (allowedTools && !allowedTools.has(tool.name)) continue;
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
