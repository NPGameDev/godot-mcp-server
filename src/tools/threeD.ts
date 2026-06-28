import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../shared/types.js";
import { registerTools } from "../registration/toolRegistry.js";
import { jsonCoerce } from "../shared/schemaCoercion.js";

const vec3Schema = z.object({
  x: z.number().optional().describe("X component"),
  y: z.number().optional().describe("Y component"),
  z: z.number().optional().describe("Z component"),
});

const colorSchema = z.object({
  r: z.number().optional().describe("Red 0-1"),
  g: z.number().optional().describe("Green 0-1"),
  b: z.number().optional().describe("Blue 0-1"),
  a: z.number().optional().describe("Alpha 0-1"),
});

export const threeDTools: ToolDef[] = [
  {
    name: "3d_create_primitive",
    method: "3d.create_primitive",
    description:
      "Create a 3D mesh primitive (box, sphere, cylinder, capsule, plane, prism) as a MeshInstance3D node. Optionally set size, material, and position.",
    inputSchema: {
      parent_path: z.string().describe("Parent node path (e.g. '.' for scene root)"),
      primitive: z.enum(["box", "sphere", "cylinder", "capsule", "plane", "prism"]).describe("Mesh primitive type"),
      name: z.string().optional().describe("Node name (default: 'MeshInstance3D')"),
      size: z
        .preprocess(jsonCoerce, vec3Schema)
        .optional()
        .describe("Size as {x,y,z}. Interpretation depends on primitive: box→size, sphere→x=diameter/y=height, etc."),
      material: z
        .preprocess(
          jsonCoerce,
          z.object({
            type: z.literal("StandardMaterial3D").optional().describe("Material type (only StandardMaterial3D)"),
            albedo_color: z.preprocess(jsonCoerce, colorSchema).optional().describe("Base color {r,g,b,a?}"),
            metallic: z.number().optional().describe("Metallic factor 0-1"),
            roughness: z.number().optional().describe("Roughness factor 0-1"),
          }),
        )
        .optional()
        .describe("Material to apply: {type:'StandardMaterial3D', albedo_color?, metallic?, roughness?}"),
      position: z.preprocess(jsonCoerce, vec3Schema).optional().describe("World position {x,y,z}"),
    },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
    successHint: "Set material via node_set_property. Add lighting with 3d_create_light, camera with 3d_create_camera.",
  },
  {
    name: "3d_setup_environment",
    method: "3d.setup_environment",
    description:
      "Create a WorldEnvironment node with sky, ambient light, tonemapping, and fog. Sets up a complete 3D rendering environment.",
    inputSchema: {
      parent_path: z.string().describe("Parent node path (e.g. '.' for scene root)"),
      name: z.string().optional().describe("Node name (default: 'WorldEnvironment')"),
      sky: z
        .preprocess(
          jsonCoerce,
          z.object({
            type: z.string().optional().describe("Sky material type (default: ProceduralSkyMaterial)"),
            sky_top_color: z.preprocess(jsonCoerce, colorSchema).optional().describe("Sky top color {r,g,b}"),
            sky_horizon_color: z.preprocess(jsonCoerce, colorSchema).optional().describe("Sky horizon color {r,g,b}"),
            ground_bottom_color: z
              .preprocess(jsonCoerce, colorSchema)
              .optional()
              .describe("Ground bottom color {r,g,b}"),
          }),
        )
        .optional()
        .describe("Sky configuration"),
      ambient_light: z
        .preprocess(
          jsonCoerce,
          z.object({
            color: z.preprocess(jsonCoerce, colorSchema).optional().describe("Ambient light color {r,g,b}"),
            energy: z.number().optional().describe("Ambient light energy"),
          }),
        )
        .optional()
        .describe("Ambient light: {color?, energy?}"),
      tonemap: z.enum(["linear", "reinhardt", "filmic", "aces"]).optional().describe("Tonemapping mode"),
      fog: z
        .preprocess(
          jsonCoerce,
          z.object({
            enabled: z.boolean().optional().describe("Enable fog (default true)"),
            color: z.preprocess(jsonCoerce, colorSchema).optional().describe("Fog color {r,g,b}"),
            density: z.number().optional().describe("Fog density"),
          }),
        )
        .optional()
        .describe("Fog settings: {enabled?, color?, density?}"),
    },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
    successHint: "Add lights with 3d_create_light, camera with 3d_create_camera.",
  },
  {
    name: "3d_create_light",
    method: "3d.create_light",
    description:
      "Create a 3D light node (DirectionalLight3D, OmniLight3D, or SpotLight3D). Optionally set color, energy, shadow, position, and rotation.",
    inputSchema: {
      parent_path: z.string().describe("Parent node path (e.g. '.' for scene root)"),
      light_type: z.enum(["directional", "omni", "spot"]).describe("Light type"),
      name: z.string().optional().describe("Node name (default: type-specific, e.g. 'DirectionalLight3D')"),
      color: z.preprocess(jsonCoerce, colorSchema).optional().describe("Light color {r,g,b}"),
      energy: z.number().optional().describe("Light energy/intensity"),
      shadow: z.boolean().optional().describe("Enable shadow casting"),
      position: z.preprocess(jsonCoerce, vec3Schema).optional().describe("World position {x,y,z}"),
      rotation: z.preprocess(jsonCoerce, vec3Schema).optional().describe("Rotation in Euler degrees {x,y,z}"),
    },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
  },
  {
    name: "3d_create_camera",
    method: "3d.create_camera",
    description:
      "Create a Camera3D node. Set projection mode (perspective/orthogonal), FOV, position, rotation, and whether it's the current camera.",
    inputSchema: {
      parent_path: z.string().describe("Parent node path (e.g. '.' for scene root)"),
      name: z.string().optional().describe("Node name (default: 'Camera3D')"),
      projection: z.enum(["perspective", "orthogonal"]).optional().describe("Projection mode (default: perspective)"),
      fov: z.number().optional().describe("Field of view in degrees (perspective mode)"),
      size: z.number().optional().describe("Viewport size (orthogonal mode)"),
      position: z.preprocess(jsonCoerce, vec3Schema).optional().describe("World position {x,y,z}"),
      rotation: z.preprocess(jsonCoerce, vec3Schema).optional().describe("Rotation in Euler degrees {x,y,z}"),
      current: z.boolean().optional().describe("Set as the current active camera"),
    },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
  },
];

export function register(server: McpServer, bridge: Bridge, allowedTools?: Set<string>): void {
  registerTools(server, bridge, threeDTools, allowedTools);
}
