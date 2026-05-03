import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, SCREENSHOT_TIMEOUT, MAIN_SCENE, assertGuard, unwrapUntrusted } from "../helpers.js";

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
  if (!screenshotResult?.image_base64) {
    fail(`editor.screenshot: ${JSON.stringify(screenshotResult)}`);
  } else {
    const buf = Buffer.from(screenshotResult.image_base64, "base64");
    if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) {
      fail(`editor.screenshot: PNG magic bytes missing in inline data`);
    } else {
      pass(`editor.screenshot PNG ${buf.length}B (${screenshotResult.width}x${screenshotResult.height}) inline`);
    }
  }

  // Screenshot with save_path.
  const savePath = "res://smoke_screenshots/smoke.png";
  const savedScreenshot = (await bridge.call("editor.screenshot", { save_path: savePath }, SCREENSHOT_TIMEOUT)) as {
    image_base64?: string;
    path?: string;
    code?: string;
  };
  if (savedScreenshot?.path !== savePath || !savedScreenshot.image_base64)
    fail(`editor.screenshot save_path: ${JSON.stringify(savedScreenshot)}`);
  else pass(`editor.screenshot save_path -> ${savedScreenshot.path}`);

  // Reject non-res:// save_path.
  const rejectedScreenshot = (await bridge.call(
    "editor.screenshot",
    { save_path: "user://bad.png" },
    CALL_TIMEOUT,
  )) as { code?: string };
  if (rejectedScreenshot?.code !== "PATH_DENIED")
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

  // scene.close round-trip.
  const closeTestPath = "res://smoke_close_test.tscn";
  await bridge.call("scene.create", { file_path: closeTestPath, root_type: "Node", if_exists: "return" }, CALL_TIMEOUT);
  await bridge.call("scene.open", { file_path: closeTestPath }, CALL_TIMEOUT);
  const closedResult = (await bridge.call("scene.close", { file_path: closeTestPath }, CALL_TIMEOUT)) as {
    success?: boolean;
  };
  if (!closedResult?.success) fail(`scene.close happy path: ${JSON.stringify(closedResult)}`);
  else pass("scene.close happy path -> success");
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
