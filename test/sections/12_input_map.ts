import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, assertGuard } from "../helpers.js";

export async function testInputMap(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  const smokeAction = "mcp_smoke_jump_15d";
  const addActionResult = await bridge.call("input_map.add_action", { action: smokeAction, deadzone: 0.4 }, CALL_TIMEOUT) as { status?: string; deadzone?: number; code?: string };
  const isGated = addActionResult?.code === "FEATURE_DISABLED";

  if (isGated) {
    pass("input_map.* -> FEATURE_DISABLED (skipping functional tests)");
    return;
  }

  // Clean stale entry, then re-create if needed.
  if (addActionResult?.status === "returned") {
    try { await bridge.call("input_map.remove_action", { action: smokeAction }, CALL_TIMEOUT); } catch { /* noop */ }
    const freshAdd = await bridge.call("input_map.add_action", { action: smokeAction, deadzone: 0.4 }, CALL_TIMEOUT) as { status?: string; deadzone?: number };
    if (freshAdd?.status !== "created") fail(`input_map.add_action re-create after stale: ${JSON.stringify(freshAdd)}`);
  }
  if (addActionResult?.status !== "created" && addActionResult?.status !== "returned") fail(`input_map.add_action: ${JSON.stringify(addActionResult)}`);
  else pass(`input_map.add_action ${smokeAction} -> status=${addActionResult.status}, deadzone=0.4`);

  // Idempotency: same action again -> returned, EXISTING deadzone.
  const addActionIdempotent = await bridge.call("input_map.add_action", { action: smokeAction, deadzone: 0.9 }, CALL_TIMEOUT) as { status?: string; deadzone?: number; code?: string };
  if (addActionIdempotent?.status !== "returned" || typeof addActionIdempotent.deadzone !== "number" || Math.abs(addActionIdempotent.deadzone - 0.4) > 0.001) fail(`input_map.add_action repeat: expected status=returned + deadzone~=0.4 (existing), got ${JSON.stringify(addActionIdempotent)}`);
  else pass(`input_map.add_action repeat -> status=returned + deadzone~=0.4 (existing wins per 15d contract)`);

  // Bind a key event.
  const addKeyEvent = await bridge.call("input_map.action_add_event", { action: smokeAction, event: { type: "key", keycode: "SPACE" } }, CALL_TIMEOUT) as { status?: string; event?: { type?: string }; code?: string };
  if (addKeyEvent?.status !== "created" || addKeyEvent.event?.type !== "key") fail(`input_map.action_add_event SPACE: ${JSON.stringify(addKeyEvent)}`);
  else pass(`input_map.action_add_event SPACE -> status=created`);

  const addKeyIdempotent = await bridge.call("input_map.action_add_event", { action: smokeAction, event: { type: "key", keycode: "SPACE" } }, CALL_TIMEOUT) as { status?: string; code?: string };
  if (addKeyIdempotent?.status !== "returned") fail(`input_map.action_add_event SPACE repeat: expected status=returned, got ${JSON.stringify(addKeyIdempotent)}`);
  else pass(`input_map.action_add_event SPACE repeat -> status=returned (equivalent-event idempotency)`);

  // Distinct event (joypad button) does not collide.
  const addJoypadEvent = await bridge.call("input_map.action_add_event", { action: smokeAction, event: { type: "joypad_button", button_index: 0, device: -1 } }, CALL_TIMEOUT) as { status?: string; code?: string };
  if (addJoypadEvent?.status !== "created") fail(`input_map.action_add_event joypad: ${JSON.stringify(addJoypadEvent)}`);
  else pass(`input_map.action_add_event joypad_button -> status=created (no collision with SPACE)`);

  const removeKeyEvent = await bridge.call("input_map.action_remove_event", { action: smokeAction, event: { type: "key", keycode: "SPACE" } }, CALL_TIMEOUT) as { success?: boolean; event?: { type?: string }; code?: string };
  if (removeKeyEvent?.success !== true || removeKeyEvent.event?.type !== "key") fail(`input_map.action_remove_event: ${JSON.stringify(removeKeyEvent)}`);
  else pass(`input_map.action_remove_event SPACE -> success`);

  assertGuard(ctx, "input_map.action_remove_event missing",
    await bridge.call("input_map.action_remove_event", { action: smokeAction, event: { type: "key", keycode: "SPACE" } }, CALL_TIMEOUT), "NOT_FOUND", "events");
  assertGuard(ctx, "input_map.remove_action ui_accept refusal",
    await bridge.call("input_map.remove_action", { action: "ui_accept" }, CALL_TIMEOUT), "INVALID_PARAMS", ["built-in UI action", "input_map.action_remove_event"]);
  assertGuard(ctx, "input_map.action_add_event bogus type",
    await bridge.call("input_map.action_add_event", { action: smokeAction, event: { type: "telepathy" } }, CALL_TIMEOUT), "INVALID_PARAMS", ["key", "mouse_button", "joypad_button", "joypad_motion"]);
  assertGuard(ctx, "input_map.action_add_event bogus keycode",
    await bridge.call("input_map.action_add_event", { action: smokeAction, event: { type: "key", keycode: "NONSENSE" } }, CALL_TIMEOUT), "INVALID_PARAMS", "symbolic names");
  assertGuard(ctx, "input_map.add_action empty",
    await bridge.call("input_map.add_action", { action: "" }, CALL_TIMEOUT), "INVALID_PARAMS", "non-empty");

  // Cleanup.
  try { await bridge.call("input_map.remove_action", { action: smokeAction }, CALL_TIMEOUT); } catch { /* noop */ }
  pass(`input_map.* round-trip + guards complete`);
}
