/**
 * Shared response builder for screenshot tools — the one place the image-first
 * multi-content shape lives, shared by the editor and runtime screenshot tools.
 */

/**
 * A screenshot tool's multi-content MCP response: an image block first, then a
 * text metadata block. Not `ToolTextResult` (which is text-only) — the MCP SDK
 * accepts image content at runtime and each handler casts at its registration
 * site.
 */
export type ScreenshotResult = {
  content: ({ type: "image"; data: string; mimeType: string } | { type: "text"; text: string })[];
};

/**
 * Build the multi-content response for a screenshot tool: the captured image
 * first, then a JSON metadata text block. Image-first matches every screenshot
 * handler's wire contract — the agent sees the picture, then the dimensions.
 *
 * @param imageBase64 base64-encoded image bytes from the toolkit (`image_base64`).
 * @param mimeType    image MIME type; falls back to "image/png" when absent.
 * @param meta        metadata serialized into the text block. Editor/group
 *                    screenshots pass `path`; runtime omits it, so its `path` is
 *                    undefined and `JSON.stringify` drops the key.
 */
export function buildScreenshotResult(
  imageBase64: string,
  mimeType: string | undefined,
  meta: { width?: number; height?: number; bytes?: number; path?: string },
): ScreenshotResult {
  return {
    content: [
      { type: "image", data: imageBase64, mimeType: mimeType ?? "image/png" },
      {
        type: "text",
        text: JSON.stringify({
          width: meta.width,
          height: meta.height,
          bytes: meta.bytes,
          path: meta.path,
        }),
      },
    ],
  };
}
