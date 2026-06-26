import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../types.js";
import { registerTools } from "../tool_registry.js";
import { assetWriteFields } from "./_asset_write.js";

export const soundTools: ToolDef[] = [
  {
    name: "sound_generate",
    method: "sound.generate",
    description:
      "Generate a placeholder sound effect (mono WAV): waveform sine/square/triangle/sawtooth/noise, frequency, duration <=5s, volume, optional pitch sweep + fade/decay envelope. SFX only, no music.",
    inputSchema: {
      path: z.string().describe("res:// destination ending in .wav"),
      waveform: z.enum(["sine", "square", "triangle", "sawtooth", "noise"]).optional(),
      frequency: z.coerce.number().optional().describe("Hz (default 440; ignored for noise)"),
      end_frequency: z.coerce
        .number()
        .optional()
        .describe("If set, pitch sweeps frequency -> end_frequency over the duration"),
      duration: z.coerce.number().optional().describe("Seconds, max 5 (default 0.3)"),
      volume: z.coerce.number().optional().describe("Peak amplitude 0-1 (default 0.8)"),
      fade_in: z.coerce.number().optional().describe("Fade-in seconds (default ~0.003 de-click)"),
      fade_out: z.coerce.number().optional().describe("Fade-out seconds (default ~0.003 de-click)"),
      decay: z.coerce.number().optional().describe("Exponential decay time-constant in seconds (>0 = pluck/bell)"),
      ...assetWriteFields,
    },
    annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: false },
    successHint:
      "Assign the stream: node_set_property on AudioStreamPlayer / AudioStreamPlayer2D / AudioStreamPlayer3D .stream.",
    pathParams: [{ param: "path", guard: "project" }],
  },
];

export function register(server: McpServer, bridge: Bridge, allowedTools: Set<string> | null = null): void {
  registerTools(server, bridge, soundTools, allowedTools);
}
