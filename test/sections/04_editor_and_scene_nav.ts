import fs from "node:fs";

import type { TestCtx } from "../helpers.js";
import {
  CALL_TIMEOUT,
  SCREENSHOT_TIMEOUT,
  MAIN_SCENE,
  assertGuard,
  unwrapUntrusted,
  passIfHeadlessUnsupported,
} from "../helpers.js";
import { isVersionAtLeast } from "../../src/shared/version.js";

export const TOOLS_TESTED: string[] = [
  "editor_screenshot",
  "scene_open",
  "scene_close",
  "scene_create",
  "scene_delete",
  "project_get_settings",
];
export async function testEditorAndSceneNav(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  // Inline screenshot.
  const screenshotResult = (await bridge.call("editor.screenshot", {}, SCREENSHOT_TIMEOUT)) as {
    image_base64?: string;
    code?: string;
    error?: string;
    width?: number;
    height?: number;
    bytes?: number;
  };
  if (passIfHeadlessUnsupported(ctx, "editor.screenshot inline", screenshotResult)) {
    // Display-less CI: no viewport — the deterministic guard IS the correct result.
  } else if (!screenshotResult?.image_base64) {
    fail(`editor.screenshot: ${JSON.stringify(screenshotResult)}`);
  } else {
    const buf = Buffer.from(screenshotResult.image_base64, "base64");
    if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) {
      fail(`editor.screenshot: PNG magic bytes missing in inline data`);
    } else {
      pass(`editor.screenshot PNG ${buf.length}B (${screenshotResult.width}x${screenshotResult.height}) inline`);
    }
  }

  // Screenshot with save_path + image_response_mode:"both" — the image is
  // embedded AND persisted. path is now a globalized absolute file path (not the
  // res:// input), so assert it ends with the file name and the file exists on
  // disk. (This section talks straight to the toolkit WS, so it sees the raw
  // payload — the server's disk/both shaping is unit-tested in screenshotResponse.)
  const savePath = "res://smoke_screenshots/smoke.png";
  const savedScreenshot = (await bridge.call(
    "editor.screenshot",
    { save_path: savePath, image_response_mode: "both" },
    SCREENSHOT_TIMEOUT,
  )) as {
    image_base64?: string;
    path?: string;
    code?: string;
  };
  if (passIfHeadlessUnsupported(ctx, "editor.screenshot save_path both", savedScreenshot)) {
    // headless — no capture
  } else if (
    !savedScreenshot?.image_base64 ||
    typeof savedScreenshot.path !== "string" ||
    !savedScreenshot.path.endsWith("smoke.png") ||
    !fs.existsSync(savedScreenshot.path)
  ) {
    fail(`editor.screenshot save_path both: ${JSON.stringify({ ...savedScreenshot, image_base64: "<omitted>" })}`);
  } else {
    pass(`editor.screenshot save_path both -> image + file at ${savedScreenshot.path}`);
    try {
      fs.unlinkSync(savedScreenshot.path);
    } catch {
      /* best-effort cleanup */
    }
  }

  // image_response_mode:"disk" (auto-named) — the PNG is persisted and only its
  // path returns (no image bytes). Assert the lean envelope, the file on disk
  // with PNG magic, then delete it.
  const diskScreenshot = (await bridge.call(
    "editor.screenshot",
    { image_response_mode: "disk" },
    SCREENSHOT_TIMEOUT,
  )) as {
    image_base64?: string;
    path?: string;
    width?: number;
    height?: number;
    bytes?: number;
    mime_type?: string;
    code?: string;
  };
  if (passIfHeadlessUnsupported(ctx, "editor.screenshot disk", diskScreenshot)) {
    // headless — no capture
  } else if (
    diskScreenshot?.image_base64 !== undefined ||
    typeof diskScreenshot?.path !== "string" ||
    diskScreenshot.mime_type !== "image/png" ||
    typeof diskScreenshot.bytes !== "number" ||
    !fs.existsSync(diskScreenshot.path)
  ) {
    fail(`editor.screenshot disk: expected lean envelope + file, got ${JSON.stringify(diskScreenshot)}`);
  } else {
    const onDisk = fs.readFileSync(diskScreenshot.path);
    if (onDisk[0] !== 0x89 || onDisk[1] !== 0x50 || onDisk[2] !== 0x4e || onDisk[3] !== 0x47) {
      fail(`editor.screenshot disk: file at ${diskScreenshot.path} missing PNG magic`);
    } else {
      pass(`editor.screenshot disk -> no image, path=${diskScreenshot.path} (${onDisk.length}B on disk)`);
    }
    try {
      fs.unlinkSync(diskScreenshot.path);
    } catch {
      /* best-effort cleanup */
    }
  }

  // image_response_mode:"inline" (default) with a save_path — save_path is
  // validated but NOT persisted, so the response is the plain inline shape with
  // NO path key (the capture is not written to disk).
  const inlineWithSavePath = (await bridge.call(
    "editor.screenshot",
    { save_path: "res://smoke_screenshots/inline_ignored.png", image_response_mode: "inline" },
    SCREENSHOT_TIMEOUT,
  )) as {
    image_base64?: string;
    path?: string;
    code?: string;
  };
  if (passIfHeadlessUnsupported(ctx, "editor.screenshot inline+save_path", inlineWithSavePath)) {
    // headless — no capture
  } else if (!inlineWithSavePath?.image_base64 || inlineWithSavePath.path !== undefined) {
    fail(
      `editor.screenshot inline+save_path: expected image + no path, got ${JSON.stringify({ ...inlineWithSavePath, image_base64: inlineWithSavePath?.image_base64 ? "<present>" : undefined })}`,
    );
  } else {
    pass("editor.screenshot inline+save_path -> image present, no path (persist ignored)");
  }

  // Reject non-res:// save_path.
  const rejectedScreenshot = (await bridge.call(
    "editor.screenshot",
    { save_path: "user://bad.png" },
    CALL_TIMEOUT,
  )) as { code?: string };
  if (passIfHeadlessUnsupported(ctx, "editor.screenshot save_path user://", rejectedScreenshot)) {
    // headless: the display-server guard fires before path validation
  } else if (rejectedScreenshot?.code !== "PATH_DENIED")
    fail(`editor.screenshot save_path user://: expected PATH_DENIED, got ${JSON.stringify(rejectedScreenshot)}`);
  else pass("editor.screenshot save_path user:// -> PATH_DENIED");

  // scene.open — re-open the currently-edited scene.
  const openResult = (await bridge.call("scene.open", { file_path: MAIN_SCENE }, CALL_TIMEOUT)) as {
    success?: boolean;
    path?: string;
    code?: string;
  };
  if (!openResult?.success || openResult.path !== MAIN_SCENE) fail(`scene.open: ${JSON.stringify(openResult)}`);
  else pass(`scene.open ${openResult.path}`);

  const openNotFound = (await bridge.call(
    "scene.open",
    { file_path: "res://does_not_exist_smoke.tscn" },
    CALL_TIMEOUT,
  )) as { code?: string };
  if (openNotFound?.code !== "NOT_FOUND")
    fail(`scene.open bogus: expected NOT_FOUND, got ${JSON.stringify(openNotFound)}`);
  else pass("scene.open bogus -> NOT_FOUND");

  // scene.close is Godot 4.5+ only — on <4.5 it is unregistered (calls would throw
  // JSON-RPC -32601); skip the whole block there so the rest of section 04 still runs.
  // Mirrors section 08's gate. (Prettier reindents the wrapped block.)
  const godotVer = bridge.getGodotVersion();
  if (godotVer != null && isVersionAtLeast(godotVer, "4.5")) {
    // scene.close round-trip.
    const closeTestPath = "res://smoke_close_test.tscn";
    await bridge.call(
      "scene.create",
      { file_path: closeTestPath, root_type: "Node", if_exists: "return" },
      CALL_TIMEOUT,
    );
    await bridge.call("scene.open", { file_path: closeTestPath }, CALL_TIMEOUT);
    const closedResult = (await bridge.call("scene.close", { file_path: closeTestPath }, CALL_TIMEOUT)) as {
      success?: boolean;
      unsaved_changes_discarded?: boolean;
    };
    if (!closedResult?.success) fail(`scene.close happy path: ${JSON.stringify(closedResult)}`);
    else pass("scene.close happy path -> success");
    // Dirty disclosure is best-effort: the field is reported only on Godot 4.7+
    // (where a dirty query is bound) and omitted below it. Assert presence + type
    // on 4.7, and confirmed absence below — not a fixed true/false, which depends
    // on whether the closed tab actually held unsaved edits.
    const has = Object.prototype.hasOwnProperty.call(closedResult, "unsaved_changes_discarded");
    if (isVersionAtLeast(godotVer, "4.7")) {
      if (has && typeof closedResult.unsaved_changes_discarded === "boolean")
        pass("scene.close discloses unsaved_changes_discarded (bool) on 4.7+");
      else fail(`scene.close 4.7 should disclose unsaved_changes_discarded: ${JSON.stringify(closedResult)}`);
    } else if (has) {
      fail(`scene.close <4.7 must omit unsaved_changes_discarded: ${JSON.stringify(closedResult)}`);
    } else {
      pass("scene.close omits unsaved_changes_discarded below 4.7");
    }
    assertGuard(
      ctx,
      "scene.close already-closed",
      await bridge.call("scene.close", { file_path: closeTestPath }, CALL_TIMEOUT),
      "NOT_FOUND",
      "not open",
    );
    await bridge.call("scene.delete", { file_path: closeTestPath }, CALL_TIMEOUT);

    // scene.close guard rejections.
    assertGuard(
      ctx,
      "scene.close no res://",
      await bridge.call("scene.close", { file_path: "/tmp/foo.tscn" }, CALL_TIMEOUT),
      "PATH_DENIED",
      "absolute",
    );
    assertGuard(
      ctx,
      "scene.close not open",
      await bridge.call("scene.close", { file_path: "res://nonexistent_scene.tscn" }, CALL_TIMEOUT),
      "NOT_FOUND",
      "not open",
    );
    // Closing the last tab is refused — the editor must always have at least one scene open.
    // Ensure Main.tscn is the active tab (scene.close only works on the active tab).
    await bridge.call("scene.open", { file_path: MAIN_SCENE }, CALL_TIMEOUT);
    const lastTabResult = (await bridge.call("scene.close", { file_path: MAIN_SCENE }, CALL_TIMEOUT)) as {
      success?: boolean;
      code?: string;
      error?: string;
    };
    if (lastTabResult?.code === "EDITED_SCENE" && lastTabResult?.error?.includes("last open scene tab")) {
      pass("scene.close last tab -> EDITED_SCENE (message mentions last open scene tab)");
    } else if (lastTabResult?.success === true) {
      // Other editor tabs were open — Main.tscn wasn't the last tab. Re-open it for later tests.
      await bridge.call("scene.open", { file_path: MAIN_SCENE }, CALL_TIMEOUT);
      pass("scene.close last tab -> success (not last tab — other editor tabs open, re-opened Main)");
    } else {
      ctx.fail(`scene.close last tab: unexpected ${JSON.stringify(lastTabResult)}`);
    }
  } else {
    pass("scene.close suite -> SKIP (requires Godot 4.5+)");
  }

  // project.get_settings with prefix.
  const settingsResult = (await bridge.call("project.get_settings", { prefix: "application/" }, CALL_TIMEOUT)) as {
    settings?: unknown;
    count?: number;
    filtered_secret_count?: number;
    code?: string;
  };
  if (!settingsResult?.settings || typeof settingsResult.count !== "number") {
    fail(`project.get_settings shape: ${JSON.stringify(settingsResult)}`);
  } else if (settingsResult.count < 1) {
    fail(`project.get_settings prefix application/: expected >=1 key, got ${settingsResult.count}`);
  } else {
    const settings = (unwrapUntrusted(settingsResult.settings) ?? {}) as Record<string, unknown>;
    const secretRe = /password|token|secret|key/i;
    const leaks = Object.keys(settings).filter((k) => secretRe.test(k));
    if (leaks.length > 0) fail(`project.get_settings leaked secret-like keys: ${leaks.join(", ")}`);
    else pass(`project.get_settings prefix=application/ -> ${settingsResult.count} keys, 0 leaks`);
  }
}
