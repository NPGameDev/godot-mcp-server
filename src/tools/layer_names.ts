import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../types.js";
import { registerTools } from "../tool_registry.js";
import { jsonCoerce } from "../schema_coercion.js";

const CATEGORY_ENUM = z.enum(["2d_physics", "2d_render", "3d_physics", "3d_render"]);

export const layerNameTools: ToolDef[] = [
  {
    name: "layer_names_set",
    method: "project.set_layer_names",
    description:
      "Set physics/render layer names. category: 2d_physics|2d_render|3d_physics|3d_render. layers: {1:'Ground', 2:'Player', …} (keys 1-32).",
    inputSchema: {
      category: CATEGORY_ENUM,
      layers: z.preprocess(jsonCoerce, z.record(z.string(), z.string())).describe("Layer number (1-32) to name"),
    },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
    successHint: "Set layer masks on nodes via node_set_property with LayerMask type tag.",
  },
  {
    name: "layer_names_get",
    method: "project.get_layer_names",
    description: "Read named physics/render layers. Returns only layers with non-empty names.",
    inputSchema: {
      category: CATEGORY_ENUM,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];

export function register(server: McpServer, bridge: Bridge, allowedTools: Set<string> | null = null): void {
  registerTools(server, bridge, layerNameTools, allowedTools);
}
