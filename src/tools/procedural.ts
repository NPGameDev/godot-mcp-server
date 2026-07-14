import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../shared/types.js";
import { registerTools } from "../registration/toolRegistry.js";
import { jsonCoerce } from "../shared/schemaCoercion.js";
import { PROJECT_FILE_PATH } from "../security/pathGuard.js";

const colorSchema = z.object({
  r: z.number().optional(),
  g: z.number().optional(),
  b: z.number().optional(),
  a: z.number().optional(),
});

export const proceduralTools: ToolDef[] = [
  {
    name: "procedural_edit_gradient",
    method: "procedural.edit_gradient",
    description:
      "Create/edit a Gradient resource (.tres). Set color stops with offsets, add/remove points. For particles, sky, and visual effects.",
    inputSchema: {
      file_path: z.string().describe("Path for the .tres file (e.g. 'res://materials/sky_gradient.tres')"),
      action: z
        .enum(["set", "add_point", "remove_point"])
        .optional()
        .describe("set=replace all, add_point=add one, remove_point=delete by index (default: set)"),
      points: z
        .preprocess(
          jsonCoerce,
          z.array(
            z.object({
              offset: z.number().describe("Position 0.0-1.0"),
              color: z.preprocess(jsonCoerce, colorSchema).describe("Color {r,g,b,a?}"),
            }),
          ),
        )
        .optional()
        .describe("Gradient color stops"),
      index: z.number().int().optional().describe("Point index (for remove_point)"),
      interpolation_mode: z.enum(["linear", "cubic", "constant"]).optional().describe("Interpolation between stops"),
    },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
    operationParam: "action",
    pathParams: [PROJECT_FILE_PATH],
  },
  {
    name: "procedural_edit_curve",
    method: "procedural.edit_curve",
    description:
      "Create/edit a Curve resource (.tres). Set control points with tangents for easing, falloff, and value mapping.",
    inputSchema: {
      file_path: z.string().describe("Path for the .tres file"),
      action: z
        .enum(["set", "add_point", "remove_point", "clear"])
        .optional()
        .describe("set=replace all, add_point=add one, remove_point=delete, clear=remove all (default: set)"),
      points: z
        .preprocess(
          jsonCoerce,
          z.array(
            z.object({
              position: z.object({ x: z.number(), y: z.number() }).describe("x=input 0-1, y=output value"),
              left_tangent: z.number().optional(),
              right_tangent: z.number().optional(),
              left_mode: z.enum(["free", "linear"]).optional(),
              right_mode: z.enum(["free", "linear"]).optional(),
            }),
          ),
        )
        .optional()
        .describe("Curve control points"),
      index: z.number().int().optional().describe("Point index (for remove_point)"),
      min_value: z.number().optional().describe("Curve minimum Y value"),
      max_value: z.number().optional().describe("Curve maximum Y value"),
    },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
    operationParam: "action",
    pathParams: [PROJECT_FILE_PATH],
  },
  {
    name: "procedural_edit_noise",
    method: "procedural.edit_noise",
    description:
      "Create/edit a FastNoiseLite resource (.tres). Configure noise type, fractal, cellular, and domain warp for procedural generation.",
    inputSchema: {
      file_path: z.string().describe("Path for the .tres file"),
      noise_type: z
        .enum(["simplex", "simplex_smooth", "cellular", "perlin", "value", "value_cubic"])
        .optional()
        .describe("Noise algorithm"),
      seed: z.number().int().optional().describe("Random seed"),
      frequency: z.number().optional().describe("Base frequency (default 0.01)"),
      octaves: z.number().int().optional().describe("Fractal octaves 1-10"),
      lacunarity: z.number().optional().describe("Octave frequency multiplier"),
      gain: z.number().optional().describe("Octave amplitude multiplier"),
      fractal_type: z.enum(["none", "fbm", "ridged", "ping_pong"]).optional().describe("Fractal type"),
      cellular_distance_function: z.enum(["euclidean", "euclidean_squared", "manhattan", "hybrid"]).optional(),
      cellular_return_type: z
        .enum([
          "cell_value",
          "distance",
          "distance2",
          "distance2_add",
          "distance2_sub",
          "distance2_mul",
          "distance2_div",
        ])
        .optional(),
      domain_warp_enabled: z.boolean().optional(),
      domain_warp_amplitude: z.number().optional(),
    },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
    pathParams: [PROJECT_FILE_PATH],
  },
];

export function register(server: McpServer, bridge: Bridge, allowedTools?: Set<string>): void {
  registerTools(server, bridge, proceduralTools, allowedTools);
}
