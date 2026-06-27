/**
 * Per-tool callback factory — build the registerTool handler for one tool def,
 * routing each tool to the right transport: signal_emit's dual-mode (editor vs
 * runtime) bridge call, editor_screenshot's multi-content image response, the
 * LSP tools' own TCP client, and the default callAndWrap path (runtime- vs
 * editor-bridge). A clean leaf — its sole caller is registerGroupTools; it
 * calls nothing group-internal above it. Extracted from groups.ts (concern
 * 077, C3).
 */
import type { Bridge, ToolDef } from "./types.js";
import { callAndWrap } from "./tool_dispatch.js";
import { toolErrorFromPayload, toolErrorFromException } from "./error_contract.js";
import { buildScreenshotResult } from "./screenshot_response.js";
import { RUNTIME_TOOLS, LSP_TOOLS } from "./group_catalogue.js";
import { createLspHandler } from "./tools/lsp.js";

// ── Special-case handlers ────────────────────────────────────────────
// Tools with non-standard response processing. Each returns a handler
// function matching the registerTool callback signature.

/** signal_emit has dual-mode routing (editor or runtime). */
function handleSignalEmit(bridge: Bridge, def: ToolDef) {
  return async (input: unknown) => {
    const parsed = input as { node_path: string; signal_name: string; args?: unknown[]; mode?: string };
    const mode = parsed.mode ?? "editor";
    const params = { node_path: parsed.node_path, signal_name: parsed.signal_name, args: parsed.args ?? [] };
    return callAndWrap(bridge, def.method, params, { runtime: mode === "runtime" });
  };
}

/** editor_screenshot returns multi-content (image + text metadata). */
function handleEditorScreenshot(bridge: Bridge, def: ToolDef) {
  return async (input: unknown) => {
    try {
      const result = await bridge.call(def.method, input ?? {});
      const err = toolErrorFromPayload(result);
      if (err) return err;
      const obj = result as {
        image_base64?: string;
        mime_type?: string;
        width?: number;
        height?: number;
        bytes?: number;
        path?: string;
      };
      if (!obj?.image_base64) {
        return toolErrorFromPayload({
          success: false,
          code: "EMPTY_CONTENT",
          error:
            "screenshot returned no image bytes — node may lack visual content. Use editor_screenshot for full viewport.",
        })!;
      }
      return buildScreenshotResult(obj.image_base64, obj.mime_type, {
        width: obj.width,
        height: obj.height,
        bytes: obj.bytes,
        path: obj.path,
      });
    } catch (err) {
      return toolErrorFromException(err);
    }
  };
}

// ── Handler dispatch ─────────────────────────────────────────────────

/**
 * Create the handler for a given tool, respecting runtime routing
 * and special-case tools.
 */
export function createHandler(bridge: Bridge, def: ToolDef) {
  switch (def.name) {
    case "signal_emit":
      return handleSignalEmit(bridge, def);
    case "editor_screenshot":
      return handleEditorScreenshot(bridge, def);
    default: {
      if (LSP_TOOLS.has(def.name)) {
        const projectPath = process.env.GODOT_MCP_PROJECT_PATH ?? process.cwd();
        return createLspHandler(def.name, projectPath);
      }
      const useRuntime = RUNTIME_TOOLS.has(def.name);
      return (input: unknown) => callAndWrap(bridge, def.method, input, { runtime: useRuntime });
    }
  }
}
