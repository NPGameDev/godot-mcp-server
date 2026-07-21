import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef, ToolTextResult } from "../shared/types.js";
import { registerTools } from "../registration/toolRegistry.js";
import { jsonCoerce, coercedBoolean } from "../shared/schemaCoercion.js";
import { toolErrorFromException, toolErrorFromPayload } from "../shared/errorContract.js";
import { stableStringify } from "../shared/stableJson.js";
import { PROJECT_FILE_PATH } from "../security/pathGuard.js";
import { buildScreenshotResult } from "../registration/screenshotResponse.js";
import { PAGE_FIELD, type PaginatedResult } from "../shared/pagination.js";

// ── Tool definitions ─────────────────────────────────────────────────

export const editorTools: ToolDef[] = [
  {
    name: "editor_save_scene",
    method: "editor.save_scene",
    description: "Save the current edited scene. Optional file_path triggers save-as.",
    inputSchema: { file_path: z.string().optional() },
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false, destructiveHint: false },
    pathParams: [PROJECT_FILE_PATH],
  },
  {
    name: "editor_screenshot",
    method: "editor.screenshot",
    description:
      "Capture the editor viewport (NOT the running game — use runtime_screenshot for that). Pass node_path to focus one node. image_response_mode 'disk' saves the PNG and returns only its path.",
    inputSchema: {
      save_path: z
        .string()
        .optional()
        .describe(
          "Destination .png used by image_response_mode disk/both (res:// or user://screenshots/); auto-named under user://screenshots/ when omitted.",
        ),
      node_path: z.string().optional().describe("Focus + capture a specific node instead of the full viewport"),
      image_response_mode: z
        .enum(["inline", "disk", "both"])
        .optional()
        .describe(
          "How to return the capture: 'inline' (default) embeds the PNG; 'disk' persists it and returns only the path — use for very large captures or to conserve context tokens; 'both' does both. Files written to disk are always full resolution, regardless of image_detail.",
        ),
      image_detail: z
        .enum(["full", "mid", "low"])
        .optional()
        .describe(
          "Resolution of the returned inline image only. full = native; mid ≈ 1024 px long edge; low ≈ 512 px (gross layout/motion only — not for reading text). Does not affect files written to disk.",
        ),
      force_foreground_editor: z
        .boolean()
        .optional()
        .describe(
          "If true, un-minimize + raise/focus the editor window before capturing (default false). Set it when driving from a terminal and editor_screenshot reports EDITOR_VIEWPORT_UNAVAILABLE; leave false in interactive use so your window isn't raised.",
        ),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    successHint: "For running game visuals use runtime_screenshot. Pass node_path for focused capture.",
    // save_path accepts res:// OR user://screenshots/ (matches editor_commands.gd).
    pathParams: [{ param: "save_path", prefixes: ["res://", "user://screenshots/"] }],
  },
  {
    // Deliberately detailed description: agents must know this handles ALL file
    // types (not just scripts) and when to call it (after external file creation).
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
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
  },
  {
    name: "scene_open",
    method: "scene.open",
    description:
      "Open a scene (.tscn / .scn) as the active edited scene. res:// only; NOT_FOUND if the file doesn't exist.",
    inputSchema: { file_path: z.string() },
    annotations: { readOnlyHint: true, openWorldHint: false },
    successHint: "View structure with scene_get_tree. Query specific nodes with scene_query.",
    pathParams: [PROJECT_FILE_PATH],
  },
  {
    name: "scene_close",
    method: "scene.close",
    description:
      "Close an open scene tab by file_path. Discards unsaved edits — save with editor_save_scene first. Auto-creates an empty scene when the last tab closes. NOT_FOUND if not open. Requires Godot 4.5+.",
    inputSchema: { file_path: z.string() },
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: true },
    godotMinVersion: "4.5",
    pathParams: [PROJECT_FILE_PATH],
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
      "Tail editor Output. source='buffer' (default): live editor console on 4.5+, game-log tail on 4.2-4.4. source='file': the game-written log (never editor output, any version). " +
      "level_filter, since_id, text_filter (is_regex=true for regex). Carries returned/total_lines/has_more + next_id — page via since_id. " +
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
    successHint: "For runtime crash logs use debugger_get_log. Use since_id for incremental reads.",
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
    annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
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
    // The toolkit is the sole envelope author (REFLECT); read its paged fields
    // through PAGE_FIELD so a rename lands in one place, not scattered literals.
    const obj = result as PaginatedResult;
    const returned = typeof obj[PAGE_FIELD.returned] === "number" ? (obj[PAGE_FIELD.returned] as number) : 0;
    // total_lines: the pre-cap line count (full number of lines before the tail slice).
    const total = typeof obj[PAGE_FIELD.totalLines] === "number" ? (obj[PAGE_FIELD.totalLines] as number) : returned;
    const summary = `${returned} line${returned !== 1 ? "s" : ""} (of ${total} total)`;
    const text = stableStringify({ _summary: summary, ...obj });
    return { content: [{ type: "text" as const, text }] };
  } catch (e) {
    return toolErrorFromException(e);
  }
}

/**
 * Handler for the editor screenshot tool. The inline/both capture returns an
 * image block plus metadata; a disk-mode capture persists the PNG toolkit-side
 * and returns just its file path (no image bytes) — that lean payload carries a
 * `path` with no `image_base64`, so it takes the disk branch before the
 * empty-content guard rather than being mistaken for a failed capture.
 */
async function screenshotHandler(bridge: Bridge, method: string, input: unknown) {
  let result: {
    image_base64?: string;
    mime_type?: string;
    width?: number;
    height?: number;
    bytes?: number;
    path?: string;
    remediation?: string[];
    hint?: string;
    image_detail?: string;
    returned?: string;
  };
  try {
    result = (await bridge.call(method, input ?? {})) as typeof result;
  } catch (err) {
    return toolErrorFromException(err);
  }
  const payloadErr = toolErrorFromPayload(result);
  if (payloadErr) return payloadErr;
  // Disk-mode capture: PNG persisted, only the path returned. A saved path with
  // no image bytes is a success, not the empty-content failure below.
  if (result?.path && !result.image_base64) {
    return buildScreenshotResult(undefined, result.mime_type, {
      width: result.width,
      height: result.height,
      bytes: result.bytes,
      path: result.path,
      remediation: result.remediation,
      hint: result.hint,
      image_detail: result.image_detail,
      returned: result.returned,
    });
  }
  if (!result?.image_base64) {
    return toolErrorFromPayload({
      success: false,
      code: "EMPTY_CONTENT",
      error:
        "screenshot returned no image bytes — node may lack visual content. Use editor_screenshot for full viewport.",
    })!;
  }
  return buildScreenshotResult(result.image_base64, result.mime_type, {
    width: result.width,
    height: result.height,
    bytes: result.bytes,
    path: result.path,
    remediation: result.remediation,
    hint: result.hint,
    image_detail: result.image_detail,
    returned: result.returned,
  });
}

// ── Registration ─────────────────────────────────────────────────────

export function register(server: McpServer, bridge: Bridge, allowedTools?: Set<string>): void {
  const handlers = new Map<string, (input: Record<string, unknown>) => Promise<ToolTextResult>>();
  handlers.set("editor_get_console", (input) => consoleSummaryHandler(bridge, "editor.get_console", input));
  // Screenshot handler returns image+text multi-content; cast to ToolTextResult
  // since the MCP SDK accepts any content type at runtime.
  handlers.set(
    "editor_screenshot",
    (input) => screenshotHandler(bridge, "editor.screenshot", input) as Promise<ToolTextResult>,
  );
  registerTools(server, bridge, editorTools, allowedTools, { handlers });
}
