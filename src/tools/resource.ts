import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Bridge, Profile, callAndWrap, includesInProfile } from "../types.js";
import { ToolDef } from "./scene.js";

export const resourceTools: ToolDef[] = [
  {
    name: "resource_load",
    method: "resource.load",
    description: "Load a res:// resource and return { class, path, properties, metadata }. Heavy fields (image, mesh_arrays) pruned; Texture2D gets size in metadata.",
    inputSchema: { path: z.string() },
  },
  {
    name: "resource_create",
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
    method: "resource.delete",
    description:
      "Delete the .tres/.res and its .uid companion at path. No active-use guard (Godot refs survive file deletion; detect orphans via editor_get_errors).",
    inputSchema: { path: z.string() },
  },
];

export function register(server: McpServer, bridge: Bridge, profile: Profile = "full"): void {
  for (const tool of resourceTools) {
    if (!includesInProfile(tool.name, profile)) continue;
    // TODO(iter-18): wrap `properties` in an <untrusted kind="resource_props">
    // envelope if the underlying data came from disk. Skip for built-in
    // engine metadata (width/height) — those are trusted engine output.
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      (input: unknown) => callAndWrap(bridge, tool.method, input),
    );
  }
}
