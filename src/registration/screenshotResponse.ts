/**
 * Shared response builder for screenshot tools — the one place the image-first
 * multi-content shape lives, shared by the editor and runtime screenshot tools.
 */

/**
 * A screenshot tool's MCP response. With image bytes it is multi-content — an
 * image block first, then a text metadata block; without them (a disk-only
 * capture) it is a single text block carrying the on-disk file path. Not
 * `ToolTextResult` (which is text-only), because the image variant carries an
 * image block the MCP SDK accepts at runtime; each handler casts at its
 * registration site.
 */
export type ScreenshotResult = {
  content: ({ type: "image"; data: string; mimeType: string } | { type: "text"; text: string })[];
};

/**
 * Build a screenshot tool's response from the toolkit payload.
 *
 * When `imageBase64` is present the response is image-first: the captured image
 * block, then a JSON metadata text block — the agent sees the picture, then the
 * dimensions. When it is absent (a `disk`-mode capture that persisted the PNG
 * and returned only its path), the response is a single lean text block naming
 * the on-disk `path` — no empty image block.
 *
 * @param imageBase64 base64 image bytes from the toolkit (`image_base64`), or
 *                    `undefined` for a disk-only capture that persisted the PNG.
 * @param mimeType    image MIME type; the image block falls back to "image/png"
 *                    when absent, and the disk text block omits it when absent.
 * @param meta        metadata serialized into the text block. `path` is the
 *                    saved file path (disk/both) or a node echo (inline node
 *                    focus); `hint` is any toolkit guidance to relay; `remediation`
 *                    names a visible side effect the toolkit took (main-screen
 *                    switch, foregrounding); `image_detail` is the detail level the
 *                    toolkit applied to the inline image (`full`/`mid`/`low`);
 *                    `returned` is the returned image's `"WxH"` — for disk-only the
 *                    full-res dims of the saved file. Both are relayed verbatim from
 *                    the toolkit payload — this builder never recomputes dimensions.
 *                    Undefined keys are dropped by `JSON.stringify`, so each appears
 *                    only when present.
 */
export function buildScreenshotResult(
  imageBase64: string | undefined,
  mimeType: string | undefined,
  meta: {
    width?: number;
    height?: number;
    bytes?: number;
    path?: string;
    remediation?: string[];
    hint?: string;
    image_detail?: string;
    returned?: string;
  },
): ScreenshotResult {
  if (imageBase64 === undefined) {
    // Disk-only capture: the toolkit saved the PNG and returned just its path.
    // Lean text envelope (path first — the actionable field), no image block.
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            path: meta.path,
            width: meta.width,
            height: meta.height,
            bytes: meta.bytes,
            mime_type: mimeType,
            remediation: meta.remediation,
            hint: meta.hint,
            image_detail: meta.image_detail,
            returned: meta.returned,
          }),
        },
      ],
    };
  }
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
          remediation: meta.remediation,
          hint: meta.hint,
          image_detail: meta.image_detail,
          returned: meta.returned,
        }),
      },
    ],
  };
}
