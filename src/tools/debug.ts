/**
 * Debugger tool definitions — breakpoint management + debug state
 * via the toolkit's EditorDebuggerPlugin bridge. All 4 tools are
 * group-only (lazy-loaded via discover_tools → debugger group).
 */
import { z } from "zod";

import type { ToolDef } from "../types.js";

export const debugTools: ToolDef[] = [
  {
    name: "debug_state",
    method: "debug.state",
    description:
      "Check debugger status: is a debug session active, is it paused at a breakpoint, can it be debugged. No params.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "debug_list_breakpoints",
    method: "debug.list_breakpoints",
    description:
      "List all GDScript breakpoints currently set in the script editor. Returns file paths and line numbers. .gd only.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "debug_set_breakpoint",
    method: "debug.set_breakpoint",
    description:
      "Set or clear a breakpoint at a specific file and line in the script editor. GDScript (.gd) files only.",
    inputSchema: {
      file_path: z.string().describe("res:// path to a .gd file (e.g. res://scripts/player.gd)"),
      line: z.coerce.number().int().describe("1-based line number"),
      enabled: z
        .preprocess(
          (v) => (typeof v === "string" ? v.toLowerCase() === "true" || v === "1" : v),
          z.boolean().default(true).optional(),
        )
        .describe("true to set, false to clear (default true)"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "debug_continue",
    method: "debug.continue",
    description: "Resume execution when the debugger is paused at a breakpoint. Fails if not breaked.",
    inputSchema: {},
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
];
