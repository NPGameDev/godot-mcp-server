/**
 * Per-tool callback factory — build the registerTool handler for one tool def,
 * routing each tool to the right transport: signal_emit's dual-mode (editor vs
 * runtime) bridge call, editor_screenshot's multi-content image response, the
 * LSP tools' own TCP client, and the default callAndWrap path (runtime- vs
 * editor-bridge). A leaf factory — it depends on nothing group-internal above it.
 */
import type { Bridge, ToolDef } from "../shared/types.js";
import { callAndWrap, injectSuccessHint } from "../registration/toolDispatch.js";
import { toolErrorFromPayload, toolErrorFromException } from "../shared/errorContract.js";
import { buildScreenshotResult } from "../registration/screenshotResponse.js";
import { RUNTIME_TOOLS, LSP_TOOLS } from "./groupCatalogue.js";
import { createLspHandler } from "../tools/lsp.js";

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

/**
 * editor_screenshot returns an image block plus metadata for an inline/both
 * capture, or a lean text-only path envelope for a disk-mode capture (PNG
 * persisted toolkit-side, only its file path returned — no image bytes).
 */
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
        remediation?: string[];
        hint?: string;
        image_detail?: string;
        returned?: string;
      };
      // Disk-mode capture: a saved path with no image bytes is a success, not the
      // empty-content failure below.
      if (obj?.path && !obj.image_base64) {
        return buildScreenshotResult(undefined, obj.mime_type, {
          width: obj.width,
          height: obj.height,
          bytes: obj.bytes,
          path: obj.path,
          remediation: obj.remediation,
          hint: obj.hint,
          image_detail: obj.image_detail,
          returned: obj.returned,
        });
      }
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
        remediation: obj.remediation,
        hint: obj.hint,
        image_detail: obj.image_detail,
        returned: obj.returned,
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
export function createGroupToolHandler(bridge: Bridge, def: ToolDef) {
  switch (def.name) {
    case "signal_emit":
      return handleSignalEmit(bridge, def);
    case "editor_screenshot":
      return handleEditorScreenshot(bridge, def);
    default: {
      if (LSP_TOOLS.has(def.name)) {
        const projectPath = process.env.GODOT_MCP_PROJECT_PATH ?? process.cwd();
        const handler = createLspHandler(def.name, projectPath);
        // LSP handlers own their TCP transport and never flow through callAndWrap,
        // so their declared successHint must be injected here, matching the
        // custom-handler wrapping registerTools does. injectSuccessHint no-ops on
        // an error result or a payload that already carries a hint.
        if (!def.successHint) return handler;
        const hintText = def.successHint;
        return async (input: unknown) => {
          const result = await handler(input);
          if (!result.isError) injectSuccessHint(result, hintText);
          return result;
        };
      }
      const useRuntime = RUNTIME_TOOLS.has(def.name);
      return (input: unknown) => callAndWrap(bridge, def.method, input, { runtime: useRuntime });
    }
  }
}
