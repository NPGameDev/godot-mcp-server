import { z } from "zod";
import type { ToolDef } from "../types.js";

const vec3 = z.object({ x: z.number(), y: z.number(), z: z.number() });
const vec2 = z.object({ x: z.number(), y: z.number() });
const color = z.object({
  r: z.number(),
  g: z.number(),
  b: z.number(),
  a: z.number().optional(),
});
const rangeOrFixed = z.union([z.number(), z.object({ min: z.number(), max: z.number() })]);

const colorRampPoint = z.object({
  offset: z.number(),
  color: color,
});

const curvePoint = z.object({
  x: z.number(),
  y: z.number(),
});

export const particleTools: ToolDef[] = [
  {
    name: "particles_create",
    method: "particles.create",
    description:
      "Create GPU particle system (2D/3D) with presets: fire, smoke, sparks, rain, snow, explosion, magic, dust. Inline color_ramp/scale_curve/alpha_curve. One call replaces 7+ manual steps.",
    inputSchema: {
      parent_path: z.string().describe("Parent node path"),
      name: z.string().optional().describe("Node name"),
      type: z.enum(["2d", "3d"]).describe("GPUParticles2D or GPUParticles3D"),
      preset: z
        .enum(["fire", "smoke", "sparks", "rain", "snow", "explosion", "magic", "dust"])
        .optional()
        .describe("Effect preset (overridable with explicit params)"),
      amount: z.number().int().optional().describe("Particle count"),
      lifetime: z.number().optional().describe("Particle lifetime (seconds)"),
      one_shot: z.boolean().optional().describe("Single burst then stop"),
      explosiveness: z.number().optional().describe("0-1, burst factor"),
      speed_scale: z.number().optional().describe("Simulation speed"),
      local_coords: z.boolean().optional().describe("Emit in local space"),
      texture: z.string().optional().describe("Particle texture (2D, res:// path)"),
      mesh: z.enum(["quad", "box", "sphere"]).optional().describe("3D draw pass mesh"),
      emission_shape: z
        .enum(["point", "sphere", "sphere_surface", "box", "ring"])
        .optional()
        .describe("Emission shape"),
      emission_sphere_radius: z.number().optional(),
      emission_box_extents: vec3.optional().describe("Box emission half-extents"),
      direction: vec3.optional().describe("Emission direction"),
      spread: z.number().optional().describe("Spread angle (degrees, 0-180)"),
      initial_velocity: rangeOrFixed.optional().describe("Initial speed (fixed or {min,max})"),
      gravity: vec3.optional().describe("Gravity vector"),
      damping: rangeOrFixed.optional(),
      orbit_velocity: rangeOrFixed.optional(),
      scale_range: rangeOrFixed.optional().describe("Particle scale"),
      angle: rangeOrFixed.optional(),
      angular_velocity: rangeOrFixed.optional(),
      color: color.optional().describe("Flat particle color"),
      hue_variation: rangeOrFixed.optional(),
      color_ramp: z
        .union([
          z.string().describe("Path to Gradient .tres"),
          z.object({
            points: z.array(colorRampPoint),
            interpolation: z.enum(["linear", "cubic", "constant"]).optional(),
          }),
        ])
        .optional()
        .describe("Color gradient over lifetime"),
      alpha_curve: z
        .union([z.string(), z.object({ points: z.array(curvePoint) })])
        .optional()
        .describe("Alpha curve over lifetime"),
      scale_curve: z
        .union([z.string(), z.object({ points: z.array(curvePoint) })])
        .optional()
        .describe("Scale curve over lifetime"),
      turbulence_enabled: z.boolean().optional(),
      turbulence_noise_strength: z.number().optional(),
      particle_flag_align_y: z.boolean().optional(),
      position: z.union([vec2, vec3]).optional().describe("Node position"),
    },
    annotations: { openWorldHint: false },
  },
];
