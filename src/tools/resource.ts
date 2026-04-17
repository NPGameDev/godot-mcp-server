import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, Profile, ToolDef } from "../types.js";
import { callAndWrap } from "../types.js";

export const resourceTools: ToolDef[] = [
  {
    name: "resource_load",
    tier: "full",
    method: "resource.load",
    description: "Load a res:// resource and return { class, path, properties, metadata }. Heavy fields (image, mesh_arrays) pruned; Texture2D gets size in metadata.",
    inputSchema: { path: z.string() },
  },
  {
    name: "resource_create",
    tier: "full",
    method: "resource.create",
    description:
      "Create .tres/.res for resource_class. Idempotent (status created/returned/replaced; if_exists:return|fail|replace). Values: primitives, {type:'Resource'|'Vector2..4'|'Color'|'Rect2'|'NodePath',...}.",
    inputSchema: {
      path: z.string(),
      resource_class: z.string(),
      properties: z.record(z.string(), z.unknown()).optional(),
      if_exists: z.enum(["return", "fail", "replace"]).optional(),
    },
  },
  {
    name: "resource_save",
    tier: "full",
    method: "resource.save",
    description:
      "Update properties of existing .tres/.res. warnings[] for unknown keys. NOT_FOUND if missing. Values: primitives, {type:'Resource'|'Vector2..4'|'Color'|'Rect2'|'NodePath',...}.",
    inputSchema: {
      path: z.string(),
      properties: z.record(z.string(), z.unknown()),
    },
  },
  {
    name: "resource_delete",
    tier: "full",
    method: "resource.delete",
    description:
      "Delete the .tres/.res and its .uid companion at path. No active-use guard (Godot refs survive file deletion; detect orphans via editor_get_errors).",
    inputSchema: { path: z.string() },
  },
];

export function register(server: McpServer, bridge: Bridge, profile: Profile = "full"): void {
  for (const tool of resourceTools) {
    if (profile === "lite" && tool.tier !== "lite") continue;
    // TODO(security): wrap `properties` in an <untrusted kind="resource_props">
    // envelope if the underlying data came from disk.
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      (input: unknown) => callAndWrap(bridge, tool.method, input),
    );
  }
}
