import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../types.js";
import { registerTools, jsonCoerce } from "../tool_helpers.js";
import { PROJECT_FILE_PATH } from "../path_guard.js";

export const themeTools: ToolDef[] = [
  {
    name: "theme_edit",
    method: "theme.edit",
    description:
      "Create or modify a Godot Theme resource (.tres). Batch-edit colors, constants, fonts, font sizes, icons, and styleboxes for any control type.",
    inputSchema: {
      file_path: z.string().describe("Theme resource path, e.g. 'res://themes/ui_theme.tres'. Created if missing."),
      edits: z
        .preprocess(
          jsonCoerce,
          z.array(
            z.object({
              type_name: z.string().describe("Control type name, e.g. 'Button', 'Label', 'Panel'"),
              property_type: z
                .enum(["color", "constant", "font", "font_size", "icon", "stylebox"])
                .describe("Theme property category"),
              property_name: z.string().describe("Property name, e.g. 'font_color', 'font_size', 'panel'"),
              value: z
                .unknown()
                .describe(
                  "Value — shape depends on property_type: " +
                    "color: {r,g,b,a?}; constant/font_size: number; " +
                    "font/icon: res:// path string; " +
                    "stylebox: {type:'StyleBoxFlat'|'StyleBoxTexture'|'StyleBoxLine', ...props}",
                ),
            }),
          ),
        )
        .describe("Array of theme property edits to apply"),
    },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
    successHint: "Apply theme to Control via node_set_property (theme property with Resource type tag).",
    pathParams: [PROJECT_FILE_PATH],
  },
];

export function register(server: McpServer, bridge: Bridge, allowedTools: Set<string> | null = null): void {
  registerTools(server, bridge, themeTools, allowedTools);
}
