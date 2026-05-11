import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../types.js";
import { registerTools } from "../tool_helpers.js";

export const audioTools: ToolDef[] = [
  {
    name: "audiobus_edit",
    method: "audiobus.edit",
    description:
      "Manage audio buses: add/remove buses, set volume/send/solo/mute, add/remove effects (Reverb, Delay, Compressor). 'list' shows full bus layout.",
    inputSchema: {
      action: z
        .enum(["add_bus", "remove_bus", "set_bus", "add_effect", "remove_effect", "list"])
        .describe("Bus operation"),
      bus_name: z.string().optional().describe("Bus name"),
      bus_index: z.number().int().optional().describe("Bus index (alternative to name)"),
      send_to: z.string().optional().describe("Parent bus name (default: Master)"),
      volume_db: z.number().optional().describe("Volume in dB"),
      solo: z.boolean().optional().describe("Solo this bus"),
      mute: z.boolean().optional().describe("Mute this bus"),
      effect: z
        .object({
          type: z.string().describe("Effect class: Reverb, Delay, Compressor, Chorus, EQ, etc."),
          index: z.number().int().optional().describe("Effect slot index"),
          enabled: z.boolean().optional().describe("Enable/disable the effect"),
          properties: z.record(z.string(), z.unknown()).optional().describe("Effect-specific properties"),
        })
        .optional()
        .describe("Effect to add/remove"),
    },
    annotations: { openWorldHint: false },
  },
];

export function register(server: McpServer, bridge: Bridge, allowedTools: Set<string> | null = null): void {
  registerTools(server, bridge, audioTools, allowedTools);
}
