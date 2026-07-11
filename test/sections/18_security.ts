import fs from "node:fs";

import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, SCREENSHOT_TIMEOUT, assertGuard, passIfHeadlessUnsupported } from "../helpers.js";

export const TOOLS_TESTED: string[] = [
  "script_read",
  "resource_load",
  "scene_instantiate",
  "folder_create",
  "file_delete",
  "editor_screenshot",
  "project_get_settings",
];
export async function testSecurity(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  // FileGuard path traversal rejections.
  assertGuard(
    ctx,
    "FileGuard ../../../etc/passwd",
    await bridge.call("script.read", { file_path: "../../../etc/passwd" }, CALL_TIMEOUT),
    "PATH_DENIED",
    "..",
  );
  assertGuard(
    ctx,
    "FileGuard /etc/passwd",
    await bridge.call("script.read", { file_path: "/etc/passwd" }, CALL_TIMEOUT),
    "PATH_DENIED",
    "absolute",
  );
  assertGuard(
    ctx,
    "FileGuard res://../../../etc/passwd",
    await bridge.call("script.read", { file_path: "res://../../../etc/passwd" }, CALL_TIMEOUT),
    "PATH_DENIED",
    "..",
  );
  assertGuard(
    ctx,
    "FileGuard resource.load ../../secret.tres",
    await bridge.call("resource.load", { file_path: "../../secret.tres" }, CALL_TIMEOUT),
    "PATH_DENIED",
    "..",
  );
  assertGuard(
    ctx,
    "FileGuard scene.instantiate traversal scene_path",
    await bridge.call("scene.instantiate", { parent_path: ".", scene_path: "../../x.tscn" }, CALL_TIMEOUT),
    "PATH_DENIED",
    "..",
  );
  assertGuard(
    ctx,
    "FileGuard folder.create ../../up",
    await bridge.call("folder.create", { folder_path: "../../up" }, CALL_TIMEOUT),
    "PATH_DENIED",
    "..",
  );
  assertGuard(
    ctx,
    "FileGuard file.delete res://../../up.gd",
    await bridge.call("file.delete", { file_path: "res://../../up.gd" }, CALL_TIMEOUT),
    "PATH_DENIED",
    "..",
  );

  // Screenshot user://screenshots/ whitelist — an ALLOWED destination must be
  // accepted (no PATH_DENIED) and actually persisted. Persistence needs a
  // disk-writing mode ("both" keeps the image assertion too); the returned path
  // is the globalized absolute location of the saved file.
  const userShotPath = "user://screenshots/smoke_sec.png";
  const userScreenshot = (await bridge.call(
    "editor.screenshot",
    { save_path: userShotPath, image_response_mode: "both" },
    SCREENSHOT_TIMEOUT,
  )) as {
    path?: string;
    image_base64?: string;
    code?: string;
  };
  if (passIfHeadlessUnsupported(ctx, "editor.screenshot user://screenshots/ whitelist", userScreenshot)) {
    // headless — no capture
  } else if (
    !userScreenshot?.image_base64 ||
    typeof userScreenshot.path !== "string" ||
    !userScreenshot.path.endsWith("smoke_sec.png") ||
    !fs.existsSync(userScreenshot.path)
  ) {
    fail(
      `editor.screenshot user://screenshots/ whitelist: expected image + persisted file, got ${JSON.stringify({ ...userScreenshot, image_base64: userScreenshot?.image_base64 ? "<present>" : undefined })}`,
    );
  } else {
    pass(`editor.screenshot user://screenshots/ whitelist -> accepted + persisted at ${userScreenshot.path}`);
    try {
      fs.unlinkSync(userScreenshot.path);
    } catch {
      /* best-effort cleanup */
    }
  }
  const otherShot = await bridge.call("editor.screenshot", { save_path: "user://other/x.png" }, CALL_TIMEOUT);
  if (!passIfHeadlessUnsupported(ctx, "editor.screenshot user://other/x.png", otherShot)) {
    assertGuard(ctx, "editor.screenshot user://other/x.png", otherShot, "PATH_DENIED", "user://screenshots");
  }

  // Untrusted envelope check — script.read wraps content.
  const envelopeScriptPath = "res://smoke_probe.gd"; // written in testScriptOps
  const envelopeRead = (await bridge.call("script.read", { file_path: envelopeScriptPath }, CALL_TIMEOUT)) as {
    content?: string;
    code?: string;
  };
  if (!envelopeRead?.content) {
    fail(`envelope check: script.read returned no content: ${JSON.stringify(envelopeRead)}`);
  } else if (!/untrusted-[0-9a-f]+ kind="script"/.test(envelopeRead.content)) {
    fail(`envelope check: script.read content missing nonce-tagged <untrusted-*> envelope`);
  } else if (!envelopeRead.content.includes(`source="${envelopeScriptPath}"`)) {
    fail(`envelope check: script.read envelope missing source="${envelopeScriptPath}"`);
  } else if ((envelopeRead.content.match(/<untrusted-[0-9a-f]+/g) ?? []).length !== 1) {
    // Exactly one opening envelope — origin-wrap survives the server passthrough,
    // and the server does NOT re-wrap (double-wrap would corrupt the envelope).
    fail(
      `envelope check: script.read has ${(envelopeRead.content.match(/<untrusted-[0-9a-f]+/g) ?? []).length} envelopes, expected exactly 1 (double-wrap?)`,
    );
  } else {
    pass(
      `envelope check: script.read content wrapped in exactly one nonce-tagged <untrusted-* kind="script" source="${envelopeScriptPath}">`,
    );
  }

  // Untrusted envelope — resource.load wraps `properties` (exactly one envelope,
  // origin-wrapped by the toolkit; the server passes it through untouched).
  // Self-contained probe: create -> load -> assert -> delete.
  const resProbePath = "res://smoke_sec_probe.tres";
  await bridge.call("resource.write", { file_path: resProbePath, type: "Resource", properties: {} }, CALL_TIMEOUT);
  const envelopeResource = (await bridge.call("resource.load", { file_path: resProbePath }, CALL_TIMEOUT)) as {
    properties?: string;
    code?: string;
  };
  const resEnvCount =
    typeof envelopeResource?.properties === "string"
      ? (envelopeResource.properties.match(/<untrusted-[0-9a-f]+/g) ?? []).length
      : 0;
  if (
    typeof envelopeResource?.properties !== "string" ||
    !/untrusted-[0-9a-f]+ kind="resource"/.test(envelopeResource.properties)
  ) {
    fail(
      `envelope check: resource.load properties missing nonce-tagged <untrusted-* kind="resource">: ${JSON.stringify(envelopeResource)?.slice(0, 200)}`,
    );
  } else if (resEnvCount !== 1) {
    fail(`envelope check: resource.load properties has ${resEnvCount} envelopes, expected exactly 1 (double-wrap?)`);
  } else {
    pass(`envelope check: resource.load properties wrapped in exactly one nonce-tagged <untrusted-* kind="resource">`);
  }
  await bridge.call("resource.delete", { file_path: resProbePath }, CALL_TIMEOUT);

  // Untrusted envelope on project.get_settings.
  const envelopeSettings = (await bridge.call("project.get_settings", { prefix: "application/" }, CALL_TIMEOUT)) as {
    settings?: string;
    code?: string;
  };
  if (
    typeof envelopeSettings?.settings !== "string" ||
    !/untrusted-[0-9a-f]+ kind="project_settings"/.test(envelopeSettings.settings)
  ) {
    fail(
      `envelope check: project.get_settings missing nonce-tagged <untrusted-*> wrapper: ${JSON.stringify(envelopeSettings)?.slice(0, 200)}`,
    );
  } else {
    pass(`envelope check: project.get_settings wrapped in nonce-tagged <untrusted-* kind="project_settings">`);
  }
}
