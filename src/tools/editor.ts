import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef, ToolTextResult } from "../types.js";
import { toolErrorFromException, toolErrorFromPayload, registerTools } from "../tool_helpers.js";
import { stableStringify } from "../schema_min.js";

// ── Tool definitions ─────────────────────────────────────────────────

export const editorTools: ToolDef[] = [
  {
    name: "editor_get_errors",
    method: "editor.get_errors",
    description:
      "Editor-time error tail (wraps editor.get_console with level='error'). source='buffer' (default) reads the real-time in-memory ring buffer; source='file' reads the full session log file.",
    inputSchema: {
      limit: z.number().optional(),
      source: z.enum(["buffer", "file"]).optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
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
      "Capture a screenshot of the editor viewport. Returns image content inline. Optional save_path (res:// .png) also persists it to disk.",
    inputSchema: { save_path: z.string().optional() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "editor_reload_scripts",
    method: "editor.reload_scripts",
    description:
      "Rescan res:// and soft-reload scripts so the editor picks up on-disk changes. Required after external file writes in headless mode. Returns { ok }.",
    inputSchema: {},
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
    name: "editor_screenshot_node",
    method: "editor.screenshot_node",
    description:
      "Focus + capture a specific node in the editor viewport. Atomic focus-restore (prior selection preserved). Inline base64 PNG.",
    inputSchema: {
      node_path: z.string(),
      size: z.object({ width: z.number(), height: z.number() }).optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "editor_get_console",
    method: "editor.get_console",
    description:
      "Tail editor Output panel. source='buffer'(default) reads in-memory ring buffer; source='file' reads full session log. level_filter + since_id for polling.",
    inputSchema: {
      limit: z.number().optional(),
      level_filter: z.array(z.enum(["info", "warning", "error"])).optional(),
      since_id: z.number().optional(),
      source: z.enum(["buffer", "file"]).optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "editor_wait_for_idle",
    method: "editor.wait_for_idle",
    description:
      "Poll EditorFileSystem.is_scanning() until idle or timeout_ms (default 10s, cap 30s). Use after asset.import, editor.reload_scripts, or file mutations.",
    inputSchema: {
      timeout_ms: z.number().optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  // project_set_setting is feature-gated (dual-gate: env AND PS). Plugin-side
  // FeatureGate performs the full check as defence-in-depth; the gate here
  // controls MCP catalogue visibility only.
  {
    name: "project_set_setting",
    method: "project.set_setting",
    description:
      "Write a ProjectSettings key and persist via ProjectSettings.save. Refuses mcp/unsafe/* and editor/* prefixes. Returns previous_value. Update (no status).",
    inputSchema: {
      key: z.string(),
      value: z.unknown(),
    },
    annotations: { openWorldHint: false },
    gate: "project_set_setting",
  },
];

// ── Custom handlers ──────────────────────────────────────────────────

/**
 * Summary-first handler for editor_get_errors — prefixes an error count
 * so the model sees the headline before the (potentially large) error text.
 */
async function errorSummaryHandler(bridge: Bridge, method: string, input: unknown) {
  try {
    const result = await bridge.call(method, input);
    const err = toolErrorFromPayload(result);
    if (err) return err;
    const obj = result as Record<string, unknown>;
    const count = typeof obj.count === "number" ? obj.count : 0;
    const summary = `${count} error${count !== 1 ? "s" : ""}`;
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
    return toolErrorFromPayload({ success: false, code: "INTERNAL", error: "screenshot returned no image bytes" })!;
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
  handlers.set("editor_get_errors", (input) => errorSummaryHandler(bridge, "editor.get_errors", input));
  // Screenshot handlers return image+text multi-content; cast to ToolTextResult
  // since the MCP SDK accepts any content type at runtime.
  handlers.set(
    "editor_screenshot",
    (input) => screenshotHandler(bridge, "editor.screenshot", input) as Promise<ToolTextResult>,
  );
  handlers.set(
    "editor_screenshot_node",
    (input) => screenshotHandler(bridge, "editor.screenshot_node", input) as Promise<ToolTextResult>,
  );
  registerTools(server, bridge, editorTools, allowedTools ? allowedTools : null, { handlers });
}
