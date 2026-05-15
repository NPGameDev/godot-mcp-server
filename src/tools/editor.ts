import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef, ToolTextResult } from "../types.js";
import {
  toolErrorFromException,
  toolErrorFromPayload,
  registerTools,
  jsonCoerce,
  coercedBoolean,
} from "../tool_helpers.js";
import { stableStringify } from "../schema_min.js";

// ── Tool definitions ─────────────────────────────────────────────────

export const editorTools: ToolDef[] = [
  {
    name: "editor_save_scene",
    method: "editor.save_scene",
    description: "Save the current edited scene. Optional file_path triggers save-as.",
    inputSchema: { file_path: z.string().optional() },
    annotations: { idempotentHint: true, openWorldHint: false },
  },
  {
    name: "editor_screenshot",
    method: "editor.screenshot",
    description:
      "Capture the editor viewport (NOT the running game). Use runtime_screenshot to capture the game window while it's running. Optional save_path (res:// .png) persists to disk. Pass node_path to focus + capture a specific node (atomic focus-restore).",
    inputSchema: {
      save_path: z.string().optional(),
      node_path: z.string().optional().describe("Focus + capture a specific node instead of the full viewport"),
      size: z
        .object({ width: z.coerce.number(), height: z.coerce.number() })
        .optional()
        .describe("Output size when capturing a specific node (default 1280x720)"),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    // I2 waiver: editor_refresh description exceeds 200-char limit.
    // Clarity is critical — agents must know this handles ALL file types
    // (not just scripts) and when to call it (after external file creation).
    name: "editor_refresh",
    method: "editor.refresh",
    description:
      "Refresh the editor's view of the filesystem — picks up new, changed, or deleted files (images, scenes, scripts, resources) and reloads open scripts. Call after creating files externally (e.g. Python, Bash) or after batch edits. With file_paths, targets specific files (O(1) per file). Without, does a full project rescan + reimport.",
    inputSchema: {
      file_paths: z
        .preprocess(jsonCoerce, z.array(z.string()))
        .optional()
        .describe("res:// paths to update; omit for full scan"),
    },
    annotations: { openWorldHint: false },
  },
  {
    name: "scene_open",
    method: "scene.open",
    description:
      "Open a scene (.tscn / .scn) as the active edited scene. res:// only; NOT_FOUND if the file doesn't exist.",
    inputSchema: { file_path: z.string() },
    annotations: { openWorldHint: false },
  },
  {
    name: "scene_close",
    method: "scene.close",
    description:
      "Close an open scene tab by file_path. Refuses the last remaining tab (EDITED_SCENE). NOT_FOUND if the scene is not open. Requires Godot 4.5+.",
    inputSchema: { file_path: z.string() },
    annotations: { openWorldHint: false },
    godotMinVersion: 5,
  },
  {
    name: "project_get_settings",
    method: "project.get_settings",
    description:
      "List ProjectSettings keys + values. Optional prefix filter. Keys matching /password|token|secret|key/i are dropped (MVP filter).",
    inputSchema: { prefix: z.string().optional() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "editor_get_console",
    method: "editor.get_console",
    description:
      "Tail editor Output panel. source='buffer'|'file'. level_filter, since_id, text_filter (is_regex=true for regex). " +
      "Primary post-crash diagnostic tool — reads runtime errors even after game_stop.",
    inputSchema: {
      limit: z.coerce.number().optional(),
      level_filter: z
        .union([z.enum(["info", "warning", "error"]), z.array(z.enum(["info", "warning", "error"]))])
        .optional()
        .describe("Single level or array of levels to filter by"),
      since_id: z.coerce.number().optional(),
      source: z.enum(["buffer", "file"]).optional(),
      text_filter: z
        .string()
        .optional()
        .describe("Substring to match against message text (case-insensitive). Set is_regex=true for regex patterns."),
      is_regex: coercedBoolean()
        .optional()
        .describe("Treat text_filter as a regex pattern instead of a plain substring (default false)."),
      clear_buffer: coercedBoolean()
        .optional()
        .describe(
          "Clear the log buffer before reading. Use when stale errors persist after successful script recompilation.",
        ),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "editor_wait_for_idle",
    method: "editor.wait_for_idle",
    description:
      "Poll EditorFileSystem.is_scanning() until idle or timeout_ms (default 10s, cap 30s). Use after asset.import, editor.refresh, or file mutations.",
    inputSchema: {
      timeout_ms: z.coerce.number().optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "project_set_setting",
    method: "project.set_setting",
    description:
      "Write a ProjectSettings key and persist via ProjectSettings.save. Refuses mcp_toolkit/*, mcp/*, and editor/* prefixes. Returns previous_value. Update (no status).",
    inputSchema: {
      setting: z.string().describe("ProjectSettings key (e.g. 'application/config/name')"),
      value: z.unknown(),
    },
    annotations: { openWorldHint: false },
  },
];

// ── Custom handlers ──────────────────────────────────────────────────

/**
 * Summary-first handler for editor_get_console — prefixes a line count
 * so the model sees the headline before the (potentially large) output.
 */
async function consoleSummaryHandler(bridge: Bridge, method: string, input: unknown) {
  try {
    // Normalize level_filter: wrap single string in an array for the plugin.
    const parsed = input as Record<string, unknown>;
    if (typeof parsed?.level_filter === "string") {
      parsed.level_filter = [parsed.level_filter];
    }
    const result = await bridge.call(method, parsed);
    const err = toolErrorFromPayload(result);
    if (err) return err;
    const obj = result as Record<string, unknown>;
    const count = typeof obj.count === "number" ? obj.count : 0;
    const total = typeof obj.total === "number" ? obj.total : count;
    const summary = `${count} line${count !== 1 ? "s" : ""} (of ${total} total)`;
    const text = stableStringify({ _summary: summary, ...obj });
    return { content: [{ type: "text" as const, text }] };
  } catch (e) {
    return toolErrorFromException(e);
  }
}

/**
 * Multi-content handler for editor screenshot tools. Both return the same
 * plugin-side shape ({ image_base64, mime_type, width, height, bytes,
 * path }); the difference is the input contract, which the bridge call
 * carries through unchanged.
 */
async function screenshotHandler(bridge: Bridge, method: string, input: unknown) {
  let result: {
    image_base64?: string;
    mime_type?: string;
    width?: number;
    height?: number;
    bytes?: number;
    path?: string;
  };
  try {
    result = (await bridge.call(method, input ?? {})) as typeof result;
  } catch (err) {
    return toolErrorFromException(err);
  }
  const payloadErr = toolErrorFromPayload(result);
  if (payloadErr) return payloadErr;
  if (!result?.image_base64) {
    return toolErrorFromPayload({
      success: false,
      code: "EMPTY_CONTENT",
      error:
        "screenshot returned no image bytes — node may lack visual content. Use editor_screenshot for full viewport.",
    })!;
  }
  return {
    content: [
      { type: "image" as const, data: result.image_base64, mimeType: result.mime_type ?? "image/png" },
      {
        type: "text" as const,
        text: JSON.stringify({ width: result.width, height: result.height, bytes: result.bytes, path: result.path }),
      },
    ],
  };
}

// ── Registration ─────────────────────────────────────────────────────

export function register(server: McpServer, bridge: Bridge, allowedTools: Set<string> | null = null): void {
  const handlers = new Map<string, (input: Record<string, unknown>) => Promise<ToolTextResult>>();
  handlers.set("editor_get_console", (input) => consoleSummaryHandler(bridge, "editor.get_console", input));
  // Screenshot handler returns image+text multi-content; cast to ToolTextResult
  // since the MCP SDK accepts any content type at runtime.
  handlers.set(
    "editor_screenshot",
    (input) => screenshotHandler(bridge, "editor.screenshot", input) as Promise<ToolTextResult>,
  );
  registerTools(server, bridge, editorTools, allowedTools ? allowedTools : null, { handlers });
}
