import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, SCREENSHOT_TIMEOUT, assertGuard } from "../helpers.js";

export async function testSecurity(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  // FileGuard path traversal rejections.
  assertGuard(ctx, "FileGuard ../../../etc/passwd",
    await bridge.call("script.read", { file_path: "../../../etc/passwd" }, CALL_TIMEOUT), "PATH_DENIED", "..");
  assertGuard(ctx, "FileGuard /etc/passwd",
    await bridge.call("script.read", { file_path: "/etc/passwd" }, CALL_TIMEOUT), "PATH_DENIED", "absolute");
  assertGuard(ctx, "FileGuard res://../../../etc/passwd",
    await bridge.call("script.read", { file_path: "res://../../../etc/passwd" }, CALL_TIMEOUT), "PATH_DENIED", "..");
  assertGuard(ctx, "FileGuard resource.load ../../secret.tres",
    await bridge.call("resource.load", { file_path: "../../secret.tres" }, CALL_TIMEOUT), "PATH_DENIED", "..");
  assertGuard(ctx, "FileGuard scene.instantiate traversal packed_path",
    await bridge.call("scene.instantiate", { parent_path: ".", packed_path: "../../x.tscn" }, CALL_TIMEOUT), "PATH_DENIED", "..");
  assertGuard(ctx, "FileGuard folder.create ../../up",
    await bridge.call("folder.create", { folder_path: "../../up" }, CALL_TIMEOUT), "PATH_DENIED", "..");

  // Screenshot user://screenshots/ whitelist.
  const userShotPath = "user://screenshots/smoke_sec.png";
  const userScreenshot = await bridge.call("editor.screenshot", { save_path: userShotPath }, SCREENSHOT_TIMEOUT) as { path?: string; image_base64?: string; code?: string };
  if (userScreenshot?.path !== userShotPath || !userScreenshot.image_base64) fail(`editor.screenshot user://screenshots/ whitelist: ${JSON.stringify(userScreenshot)}`);
  else pass(`editor.screenshot user://screenshots/ whitelist -> ${userScreenshot.path}`);
  assertGuard(ctx, "editor.screenshot user://other/x.png",
    await bridge.call("editor.screenshot", { save_path: "user://other/x.png" }, CALL_TIMEOUT), "PATH_DENIED", "user://screenshots");

  // Untrusted envelope check — script.read wraps content.
  const envelopeScriptPath = "res://smoke_probe.gd"; // written in testScriptOps
  const envelopeRead = await bridge.call("script.read", { file_path: envelopeScriptPath }, CALL_TIMEOUT) as { content?: string; code?: string };
  if (!envelopeRead?.content) {
    fail(`envelope check: script.read returned no content: ${JSON.stringify(envelopeRead)}`);
  } else if (!/untrusted-[0-9a-f]+ kind="script"/.test(envelopeRead.content)) {
    fail(`envelope check: script.read content missing nonce-tagged <untrusted-*> envelope`);
  } else if (!envelopeRead.content.includes(`source="${envelopeScriptPath}"`)) {
    fail(`envelope check: script.read envelope missing source="${envelopeScriptPath}"`);
  } else {
    pass(`envelope check: script.read content wrapped in nonce-tagged <untrusted-* kind="script" source="${envelopeScriptPath}">`);
  }

  // Untrusted envelope on project.get_settings.
  const envelopeSettings = await bridge.call("project.get_settings", { prefix: "application/" }, CALL_TIMEOUT) as { settings?: string; code?: string };
  if (typeof envelopeSettings?.settings !== "string" || !/untrusted-[0-9a-f]+ kind="project_settings"/.test(envelopeSettings.settings)) {
    fail(`envelope check: project.get_settings missing nonce-tagged <untrusted-*> wrapper: ${JSON.stringify(envelopeSettings)?.slice(0, 200)}`);
  } else {
    pass(`envelope check: project.get_settings wrapped in nonce-tagged <untrusted-* kind="project_settings">`);
  }
}
