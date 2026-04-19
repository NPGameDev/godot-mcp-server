import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, assertGuard } from "../helpers.js";

export async function testProjectSetSetting(ctx: TestCtx): Promise<void> {
  const { bridge, pass } = ctx;

  const settingKey = "application/config/mcp_smoke_15d";
  const setSettingResult = await bridge.call("project.set_setting", { key: settingKey, value: "smoke-15d-marker" }, CALL_TIMEOUT) as { success?: boolean; was_set_before?: boolean; previous_value?: unknown; key?: string; value?: unknown; code?: string };
  const isGated = setSettingResult?.code === "FEATURE_DISABLED";

  if (isGated) {
    pass("project.set_setting -> FEATURE_DISABLED (skipping functional tests)");
    return;
  }

  // Happy path: write + read back.
  const preGet = await bridge.call("project.get_settings", { prefix: "application/config" }, CALL_TIMEOUT) as { settings?: Record<string, unknown> };
  const previousValue = preGet?.settings?.[settingKey] ?? null;

  if (setSettingResult?.success !== true) ctx.fail(`project.set_setting: ${JSON.stringify(setSettingResult)}`);
  else pass(`project.set_setting ${settingKey} -> success (was_set_before=${setSettingResult.was_set_before})`);

  const postGet = await bridge.call("project.get_settings", { prefix: "application/config" }, CALL_TIMEOUT) as { settings?: Record<string, unknown> };
  if (postGet?.settings?.[settingKey] !== "smoke-15d-marker") ctx.fail(`project.set_setting round-trip: read-back ${JSON.stringify(postGet?.settings?.[settingKey])}`);
  else pass(`project.set_setting -> read-back via project.get_settings matches`);

  // Guard rejections.
  assertGuard(ctx, "project.set_setting mcp/unsafe/*",
    await bridge.call("project.set_setting", { key: "mcp/unsafe/allow_game_eval", value: true }, CALL_TIMEOUT), "INVALID_PATH", "FeatureGate");
  assertGuard(ctx, "project.set_setting editor/*",
    await bridge.call("project.set_setting", { key: "editor/something", value: "x" }, CALL_TIMEOUT), "INVALID_PATH", "editor-session state");
  assertGuard(ctx, "project.set_setting empty key",
    await bridge.call("project.set_setting", { key: "", value: 1 }, CALL_TIMEOUT), "INVALID_PARAMS", "non-empty");

  // Restore previous value.
  if (previousValue === null) {
    try { await bridge.call("project.set_setting", { key: settingKey, value: "" }, CALL_TIMEOUT); } catch { /* noop */ }
  } else {
    try { await bridge.call("project.set_setting", { key: settingKey, value: previousValue }, CALL_TIMEOUT); } catch { /* noop */ }
  }
}
