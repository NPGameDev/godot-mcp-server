/**
 * Unit tests for screenshot_response.ts — the shared screenshot-response
 * builder. Pins the byte-equivalence contract the three former inline builds
 * (tools/editor.ts, tools/runtime.ts, groups.ts) shared: image-first ordering,
 * the "image/png" mime fallback, and the exact metadata JSON bytes (key order
 * width,height,bytes,path — with `path` for editor/group, dropped for runtime).
 * Also pins the disk-mode variant: an undefined image yields a single lean text
 * block (key order path,width,height,bytes,mime_type) with no image block, and
 * the optional `hint` relays on both variants.
 */
import assert from "node:assert/strict";
import { buildScreenshotResult } from "../../src/registration/screenshotResponse.js";

// ── Editor / group shape: image-first + full metadata (with path) ────

{
  const r = buildScreenshotResult("abc", "image/png", { width: 1, height: 2, bytes: 3, path: "res://x.png" });
  // content[0] is the image block (image-first — NOT the dropped text-first order).
  assert.equal(r.content[0].type, "image", "content[0] must be the image block");
  // Whole-array deepEqual pins: length 2, [image, text] order, image block shape,
  // and the exact metadata JSON string (key order width,height,bytes,path).
  assert.deepEqual(r.content, [
    { type: "image", data: "abc", mimeType: "image/png" },
    { type: "text", text: '{"width":1,"height":2,"bytes":3,"path":"res://x.png"}' },
  ]);
}

// ── Runtime shape: no path key; undefined mime → image/png default ───

{
  const r = buildScreenshotResult("abc", undefined, { width: 1, height: 2, bytes: 3 });
  // `path` is absent (JSON.stringify drops the undefined key) — byte-identical
  // to runtime_screenshot today; undefined mimeType falls back to "image/png".
  assert.deepEqual(r.content, [
    { type: "image", data: "abc", mimeType: "image/png" },
    { type: "text", text: '{"width":1,"height":2,"bytes":3}' },
  ]);
}

// ── Mime passthrough: a provided mimeType is used verbatim ───────────

{
  const r = buildScreenshotResult("abc", "image/jpeg", { width: 1, height: 2, bytes: 3, path: "res://x.png" });
  assert.deepEqual(r.content, [
    { type: "image", data: "abc", mimeType: "image/jpeg" },
    { type: "text", text: '{"width":1,"height":2,"bytes":3,"path":"res://x.png"}' },
  ]);
}

// ── Disk mode: undefined image → a single lean text block, no image block ─

{
  const r = buildScreenshotResult(undefined, "image/png", {
    width: 1280,
    height: 720,
    bytes: 5498,
    path: "C:/proj/screenshots/shot.png",
  });
  // Exactly one content part, and it is text (never an empty image block).
  assert.equal(r.content.length, 1, "disk mode must return a single content part");
  assert.equal(r.content[0].type, "text", "disk mode content must be the text block");
  // Lean envelope, key order path,width,height,bytes,mime_type; no image_base64.
  assert.deepEqual(r.content, [
    {
      type: "text",
      text: '{"path":"C:/proj/screenshots/shot.png","width":1280,"height":720,"bytes":5498,"mime_type":"image/png"}',
    },
  ]);
}

// ── Disk mode: an absent mimeType is dropped from the lean envelope ──

{
  const r = buildScreenshotResult(undefined, undefined, { width: 1, height: 2, bytes: 3, path: "user://s/x.png" });
  assert.deepEqual(r.content, [{ type: "text", text: '{"path":"user://s/x.png","width":1,"height":2,"bytes":3}' }]);
}

// ── hint passthrough (disk branch): appended after mime_type ─────────

{
  const r = buildScreenshotResult(undefined, "image/png", {
    width: 1,
    height: 2,
    bytes: 3,
    path: "user://s/x.png",
    hint: "retry smaller",
  });
  assert.deepEqual(r.content, [
    {
      type: "text",
      text: '{"path":"user://s/x.png","width":1,"height":2,"bytes":3,"mime_type":"image/png","hint":"retry smaller"}',
    },
  ]);
}

// ── hint passthrough (image branch): appended after remediation slot ──

{
  const r = buildScreenshotResult("abc", "image/png", { width: 1, height: 2, bytes: 3, hint: "foreground it" });
  assert.deepEqual(r.content, [
    { type: "image", data: "abc", mimeType: "image/png" },
    { type: "text", text: '{"width":1,"height":2,"bytes":3,"hint":"foreground it"}' },
  ]);
}

console.log("All screenshot_response tests passed.");
