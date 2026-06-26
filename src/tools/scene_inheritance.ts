import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../types.js";
import { registerTools } from "../tool_registry.js";

export const sceneInheritanceTools: ToolDef[] = [
  {
    name: "scene_create_inherited",
    method: "scene.create_inherited",
    description:
      "Create an inherited scene (.tscn) from a base scene — Godot's prefab variant pattern. Writes minimal TSCN text, works on all 4.2-4.6.",
    inputSchema: {
      file_path: z.string().describe("Output .tscn path (e.g. 'res://scenes/slime_enemy.tscn')"),
      base_scene: z.string().describe("Base scene path (e.g. 'res://scenes/enemy.tscn')"),
      root_name: z.string().optional().describe("Root node name override (default: base scene's root name)"),
    },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
    successHint: "Add overrides with scene_create_node / node_set_property. Save with editor_save_scene.",
  },
];

export function register(server: McpServer, bridge: Bridge, allowedTools: Set<string> | null = null): void {
  registerTools(server, bridge, sceneInheritanceTools, allowedTools);
}
