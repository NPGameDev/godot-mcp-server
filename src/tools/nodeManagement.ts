import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../shared/types.js";
import { registerTools } from "../registration/toolRegistry.js";
import { coercedBoolean, jsonCoerce } from "../shared/schemaCoercion.js";

export const nodeManagementTools: ToolDef[] = [
  // Deliberately detailed description: this action-consolidated tool needs
  // per-action param documentation.
  {
    name: "node_manage",
    method: "node.manage",
    description:
      "Structural node operations on the edited scene tree.\n\n" +
      "action: rename — requires new_name.\n" +
      "action: reparent — requires new_parent_path, optional keep_global_transform (default true).\n" +
      "action: reorder — requires new_index (0-based sibling index).\n" +
      "action: duplicate — optional new_name, parent_path, properties (overrides like {position:{x,y}}).",
    inputSchema: {
      action: z.enum(["rename", "reparent", "reorder", "duplicate"]),
      node_path: z.string(),
      new_name: z.string().optional().describe("Required for rename; optional for duplicate."),
      new_parent_path: z.string().optional().describe("Required for reparent."),
      keep_global_transform: coercedBoolean()
        .optional()
        .describe("For reparent: preserve world transform. Default true."),
      new_index: z.coerce.number().int().optional().describe("For reorder: 0-based sibling index."),
      parent_path: z.string().optional().describe("For duplicate: target parent. Defaults to same parent."),
      properties: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("For duplicate: property overrides on the copy (e.g. {position:{x:100,y:200}})."),
    },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
    operationParam: "action",
    successHint:
      "After rename/reparent/reorder, scripts using $Path, get_node() paths, or %UniqueNames referencing the affected node may break. Check scripts on the moved node and its immediate neighbors.",
  },
  {
    name: "node_groups",
    method: "node.groups",
    description:
      "Manage node group membership. Groups are the idiomatic Godot way to tag and query game objects " +
      "(e.g. 'coins', 'enemies').\n\n" +
      "Single mode: node_path + group (node_path required for add/remove/list). " +
      "Batch mode: entries array of {node_path, group} carries per-item paths, and the top-level " +
      "node_path/group are ignored.\n\n" +
      "action: add — requires group. action: remove — requires group. action: list — returns all groups (single only).",
    inputSchema: {
      action: z.enum(["add", "remove", "list"]),
      node_path: z
        .string()
        .optional()
        .describe(
          "Single mode: target node path. Required for single add/remove/list; omit in batch mode (provide entries instead).",
        ),
      group: z.string().optional().describe("Group name. Required for single add/remove."),
      persistent: coercedBoolean().optional().describe("For add: save to .tscn. Default true."),
      entries: z
        .preprocess(jsonCoerce, z.array(z.record(z.string(), z.unknown())))
        .optional()
        .describe(
          "Batch mode (add/remove only): array of {node_path, group}. " +
            "When present, processes all entries as a batch." +
            "node_path and group params are ignored in batch mode.",
        ),
    },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
    operationParam: "action",
  },
  {
    name: "autoload_manage",
    method: "autoload.manage",
    description:
      "Manage project autoload singletons (GameManager, AudioManager, etc.). " +
      "Writes to project.godot; takes effect on next game launch.\n\n" +
      "action: register — requires name + script_path. action: unregister — requires name. action: list — returns all.",
    inputSchema: {
      action: z.enum(["register", "unregister", "list"]),
      name: z.string().optional().describe("Autoload name (e.g. 'GameManager'). Required for register/unregister."),
      script_path: z
        .string()
        .optional()
        .describe("Script path (e.g. 'res://scripts/game_manager.gd'). Required for register."),
      enabled: coercedBoolean().optional().describe("For register: auto-initialize on startup. Default true."),
    },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
    operationParam: "action",
  },
];

export function register(server: McpServer, bridge: Bridge, allowedTools?: Set<string>): void {
  registerTools(server, bridge, nodeManagementTools, allowedTools);
}
