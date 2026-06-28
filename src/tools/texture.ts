import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../shared/types.js";
import { registerTools } from "../registration/toolRegistry.js";
import { jsonCoerce } from "../shared/schemaCoercion.js";
import { assetWriteFields } from "./assetWrite.js";

/** A colour: a hex/named string ("#ff0000", "red") or an [r,g,b(,a)] array
 *  (0-1 or 0-255). Alpha 0 / omitted = that layer is absent. */
const colorField = z.preprocess(jsonCoerce, z.union([z.string(), z.array(z.number())]));

export const textureTools: ToolDef[] = [
  {
    name: "texture_generate",
    method: "texture.generate",
    description:
      "Generate a placeholder PNG (imports as Texture2D): a shape (solid/circle/triangle/diamond/arrow/checkerboard/grid) with fill/outline/background colours + an optional text label. Dimensions <=1024px.",
    inputSchema: {
      path: z.string().describe("res:// destination ending in .png"),
      shape: z.enum(["solid", "circle", "triangle", "diamond", "arrow", "checkerboard", "grid"]).optional(),
      width: z.coerce.number().optional().describe("Pixels, 1-1024 (default 64)"),
      height: z.coerce.number().optional().describe("Pixels, 1-1024 (default 64)"),
      fill_color: colorField.optional().describe("Interior colour; transparent = hollow shape"),
      outline_color: colorField.optional().describe("Border colour; transparent/omitted = no border"),
      outline_width: z.coerce.number().optional().describe("Border thickness in pixels (default 1)"),
      background_color: colorField.optional().describe("Canvas colour behind the shape (default transparent)"),
      label: z.string().optional().describe("Optional text overlaid centred on any shape"),
      label_color: colorField.optional(),
      direction: z.enum(["up", "down", "left", "right"]).optional().describe("Arrow direction"),
      cell_size: z.coerce.number().optional().describe("Cell size for checkerboard/grid"),
      ...assetWriteFields,
    },
    annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: false },
    successHint:
      "Assign the texture: node_set_property on Sprite2D.texture / TextureRect.texture / Button.icon, or feed spriteframes_create.",
    pathParams: [{ param: "path", guard: "project" }],
  },
];

export function register(server: McpServer, bridge: Bridge, allowedTools?: Set<string>): void {
  registerTools(server, bridge, textureTools, allowedTools);
}
