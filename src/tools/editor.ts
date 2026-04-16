import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Bridge, Profile, callAndWrap, includesInProfile, toolErrorFromException, toolErrorFromPayload } from "../types.js";
import { ToolDef } from "./scene.js";

export const editorTools: ToolDef[] = [
  {
    name: "editor_get_errors",
    method: "editor.get_errors",
    description: "Return recent GDScript compile/runtime errors from the editor. (MVP stub; iter 10 replaces with debugger_get_log.)",
    inputSchema: {},
  },
  {
    name: "editor_save_scene",
    method: "editor.save_scene",
    description: "Save the current edited scene. Optional path triggers save-as.",
    inputSchema: { path: z.string().optional() },
  },
  {
    name: "editor_screenshot",
    method: "editor.screenshot",
    description: "Capture a screenshot of the editor viewport. Returns image content inline. Optional save_path (res:// .png) also persists it to disk.",
    inputSchema: { save_path: z.string().optional() },
  },
  {
    name: "editor_reload_scripts",
    method: "editor.reload_scripts",
    description: "Rescan res:// and soft-reload already-loaded scripts so the editor picks up on-disk changes. Returns { ok: true }.",
    inputSchema: {},
  },
  {
    name: "scene_open",
    method: "scene.open",
    description: "Open a scene (.tscn / .scn) as the active edited scene. res:// only; NOT_FOUND if the file doesn't exist.",
    inputSchema: { path: z.string() },
  },
  {
    name: "project_get_settings",
    method: "project.get_settings",
    description: "List ProjectSettings keys + values. Optional prefix filter. Keys matching /password|token|secret|key/i are dropped (MVP filter — proper scrub lands iter 20).",
    inputSchema: { prefix: z.string().optional() },
  },
  {
    name: "project_set_setting",
    method: "project.set_setting",
    description:
      "Write a ProjectSettings key and persist via ProjectSettings.save. Refuses mcp/unsafe/* and editor/* prefixes. Returns previous_value. Update (no status).",
    inputSchema: {
      key: z.string(),
      value: z.unknown(),
    },
  },
  {
    name: "editor_screenshot_node",
    method: "editor.screenshot_node",
    description:
      "Focus + capture a specific node in the editor viewport. Atomic focus-restore (prior selection preserved). Inline base64 PNG.",
    inputSchema: {
      path: z.string(),
      size: z.object({ width: z.number(), height: z.number() }).optional(),
    },
  },
];

// Shared multi-content handler for editor screenshot tools (editor_screenshot
// + editor_screenshot_node from iter 15d). Both return the same plugin-side
// shape ({ image_base64, mime_type, width, height, bytes, path }); the
// difference is the input contract, which the bridge call carries through
// unchanged.
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

export function register(server: McpServer, bridge: Bridge, profile: Profile = "full"): void {
  for (const tool of editorTools) {
    if (!includesInProfile(tool.name, profile)) continue;
    if (tool.name === "editor_screenshot" || tool.name === "editor_screenshot_node") {
      server.registerTool(
        tool.name,
        { description: tool.description, inputSchema: tool.inputSchema },
        (input: unknown) => screenshotHandler(bridge, tool.method, input),
      );
    } else {
      server.registerTool(
        tool.name,
        { description: tool.description, inputSchema: tool.inputSchema },
        (input: unknown) => callAndWrap(bridge, tool.method, input),
      );
    }
  }
}
