import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Bridge, ToolDef } from "../types.js";
import { callAndWrap, toolErrorFromException, toolErrorFromPayload } from "../types.js";
import { stableStringify } from "../schema_min.js";
import { isEnabled } from "../feature_gate.js";

export const editorTools: ToolDef[] = [
  {
    name: "editor_get_errors",
    method: "editor.get_errors",
    description:
      "Editor-time error tail (wraps editor.get_console with level='error'). Use editor.get_console for warnings/info/print output.",
    inputSchema: { limit: z.number().optional() },
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
    description: "Capture a screenshot of the editor viewport. Returns image content inline. Optional save_path (res:// .png) also persists it to disk.",
    inputSchema: { save_path: z.string().optional() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "editor_reload_scripts",
    method: "editor.reload_scripts",
    description: "Rescan res:// and soft-reload already-loaded scripts so the editor picks up on-disk changes. Returns { ok: true }.",
    inputSchema: {},
    annotations: { openWorldHint: false },
  },
  {
    name: "scene_open",
    method: "scene.open",
    description: "Open a scene (.tscn / .scn) as the active edited scene. res:// only; NOT_FOUND if the file doesn't exist.",
    inputSchema: { file_path: z.string() },
    annotations: { openWorldHint: false },
  },
  {
    name: "scene_close",
    method: "scene.close",
    description:
      "Close an open scene tab by file_path. Refuses the last remaining tab (EDITED_SCENE). NOT_FOUND if the scene is not open. Frees the tab leaked by scene.open.",
    inputSchema: { file_path: z.string() },
    annotations: { openWorldHint: false },
  },
  {
    name: "project_get_settings",
    method: "project.get_settings",
    description: "List ProjectSettings keys + values. Optional prefix filter. Keys matching /password|token|secret|key/i are dropped (MVP filter).",
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
      "Tail editor Output panel (user://logs/). level_filter: info|warning|error. since_id for incremental polls.",
    inputSchema: {
      limit: z.number().optional(),
      level_filter: z.array(z.enum(["info", "warning", "error"])).optional(),
      since_id: z.number().optional(),
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
];

// project_set_setting is feature-gated (dual-gate: env AND PS). Plugin-side
// FeatureGate performs the full check as defence-in-depth; this controls
// MCP catalogue visibility only.
if (isEnabled("project_set_setting")) {
  editorTools.push({
    name: "project_set_setting",
    method: "project.set_setting",
    description:
      "Write a ProjectSettings key and persist via ProjectSettings.save. Refuses mcp/unsafe/* and editor/* prefixes. Returns previous_value. Update (no status).",
    inputSchema: {
      key: z.string(),
      value: z.unknown(),
    },
    annotations: { openWorldHint: false },
  });
}

// Multi-content handler for editor screenshot tools. Both return the same
// plugin-side shape ({ image_base64, mime_type, width, height, bytes,
// path }); the difference is the input contract, which the bridge call
// carries through unchanged.
async function screenshotHandler(
  bridge: Bridge,
  method: string,
  input: unknown,
) {
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
      { type: "text" as const, text: JSON.stringify({ width: result.width, height: result.height, bytes: result.bytes, path: result.path }) },
    ],
  };
}

export function register(server: McpServer, bridge: Bridge, allowedTools: Set<string> | null = null): void {
  for (const tool of editorTools) {
    if (allowedTools && !allowedTools.has(tool.name)) continue;
    // Summary-first: prefix error count so the model sees the headline
    // before the (potentially large) wrapped error text.
    if (tool.name === "editor_get_errors") {
      server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: tool.annotations,
        },
        async (input: unknown) => {
          try {
            const result = await bridge.call(tool.method, input);
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
        },
      );
      continue;
    }
    if (tool.name === "editor_screenshot" || tool.name === "editor_screenshot_node") {
      server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: tool.annotations,
        },
        (input: unknown) => screenshotHandler(bridge, tool.method, input),
      );
    } else {
      server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: tool.annotations,
        },
        (input: unknown) => callAndWrap(bridge, tool.method, input),
      );
    }
  }
}
