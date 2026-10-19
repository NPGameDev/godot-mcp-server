import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT, assertGuard, unwrapUntrusted } from "../helpers.js";

export const TOOLS_TESTED: string[] = ["input_map_action", "input_map_event", "input_map_list", "project_get_settings"];

export async function testInputMap(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  const smokeAction = "mcp_smoke_jump_15d";
  const addActionResult = (await bridge.call(
    "input_map.action",
    { action: "add", name: smokeAction, deadzone: 0.4 },
    CALL_TIMEOUT,
  )) as { status?: string; deadzone?: number };

  // Clean stale entry, then re-create if needed.
  if (addActionResult?.status === "returned") {
    try {
      await bridge.call("input_map.action", { action: "remove", name: smokeAction }, CALL_TIMEOUT);
    } catch {
      /* noop */
    }
    const freshAdd = (await bridge.call(
      "input_map.action",
      { action: "add", name: smokeAction, deadzone: 0.4 },
      CALL_TIMEOUT,
    )) as { status?: string; deadzone?: number };
    if (freshAdd?.status !== "created") fail(`input_map.action add re-create after stale: ${JSON.stringify(freshAdd)}`);
  }
  if (addActionResult?.status !== "created" && addActionResult?.status !== "returned")
    fail(`input_map.action add: ${JSON.stringify(addActionResult)}`);
  else pass(`input_map.action add ${smokeAction} -> status=${addActionResult.status}, deadzone=0.4`);

  // Idempotency: same action again -> returned, EXISTING deadzone.
  const addActionIdempotent = (await bridge.call(
    "input_map.action",
    { action: "add", name: smokeAction, deadzone: 0.9 },
    CALL_TIMEOUT,
  )) as { status?: string; deadzone?: number; code?: string };
  if (
    addActionIdempotent?.status !== "returned" ||
    typeof addActionIdempotent.deadzone !== "number" ||
    Math.abs(addActionIdempotent.deadzone - 0.4) > 0.001
  )
    fail(
      `input_map.action add repeat: expected status=returned + deadzone~=0.4 (existing), got ${JSON.stringify(addActionIdempotent)}`,
    );
  else pass(`input_map.action add repeat -> status=returned + deadzone~=0.4 (existing wins per 15d contract)`);

  // Bind a key event.
  const addKeyEvent = (await bridge.call(
    "input_map.event",
    { action: "bind", name: smokeAction, event: { type: "key", keycode: "SPACE" } },
    CALL_TIMEOUT,
  )) as { status?: string; event?: { type?: string }; code?: string };
  if (addKeyEvent?.status !== "created" || addKeyEvent.event?.type !== "key")
    fail(`input_map.event bind SPACE: ${JSON.stringify(addKeyEvent)}`);
  else pass(`input_map.event bind SPACE -> status=created`);

  const addKeyIdempotent = (await bridge.call(
    "input_map.event",
    { action: "bind", name: smokeAction, event: { type: "key", keycode: "SPACE" } },
    CALL_TIMEOUT,
  )) as { status?: string; code?: string };
  if (addKeyIdempotent?.status !== "returned")
    fail(`input_map.event bind SPACE repeat: expected status=returned, got ${JSON.stringify(addKeyIdempotent)}`);
  else pass(`input_map.event bind SPACE repeat -> status=returned (equivalent-event idempotency)`);

  // Distinct event (joypad button) does not collide.
  const addJoypadEvent = (await bridge.call(
    "input_map.event",
    { action: "bind", name: smokeAction, event: { type: "joypad_button", button_index: 0, device: -1 } },
    CALL_TIMEOUT,
  )) as { status?: string; code?: string };
  if (addJoypadEvent?.status !== "created") fail(`input_map.event bind joypad: ${JSON.stringify(addJoypadEvent)}`);
  else pass(`input_map.event bind joypad_button -> status=created (no collision with SPACE)`);

  const removeKeyEvent = (await bridge.call(
    "input_map.event",
    { action: "unbind", name: smokeAction, event: { type: "key", keycode: "SPACE" } },
    CALL_TIMEOUT,
  )) as { success?: boolean; event?: { type?: string }; code?: string };
  if (removeKeyEvent?.success !== true || removeKeyEvent.event?.type !== "key")
    fail(`input_map.event unbind: ${JSON.stringify(removeKeyEvent)}`);
  else pass(`input_map.event unbind SPACE -> success`);

  assertGuard(
    ctx,
    "input_map.event unbind missing",
    await bridge.call(
      "input_map.event",
      { action: "unbind", name: smokeAction, event: { type: "key", keycode: "SPACE" } },
      CALL_TIMEOUT,
    ),
    "NOT_FOUND",
    "events",
  );
  assertGuard(
    ctx,
    "input_map.action remove ui_accept refusal",
    await bridge.call("input_map.action", { action: "remove", name: "ui_accept" }, CALL_TIMEOUT),
    "INVALID_PARAMS",
    ["built-in UI action"],
  );
  assertGuard(
    ctx,
    "input_map.event bind bogus type",
    await bridge.call(
      "input_map.event",
      { action: "bind", name: smokeAction, event: { type: "telepathy" } },
      CALL_TIMEOUT,
    ),
    "INVALID_PARAMS",
    ["key", "mouse_button", "joypad_button", "joypad_motion"],
  );
  assertGuard(
    ctx,
    "input_map.event bind bogus keycode",
    await bridge.call(
      "input_map.event",
      { action: "bind", name: smokeAction, event: { type: "key", keycode: "NONSENSE" } },
      CALL_TIMEOUT,
    ),
    "INVALID_PARAMS",
    "symbolic names",
  );
  assertGuard(
    ctx,
    "input_map.action add empty",
    await bridge.call("input_map.action", { action: "add", name: "" }, CALL_TIMEOUT),
    "INVALID_PARAMS",
    "non-empty",
  );

  await testBuiltinBindKeepsJoypadDefaults(ctx);
  await testListRevertAndRoundTrip(ctx);

  // Rename keeps the action's events: the joypad_button bound above unbinds under the new name.
  const renamedAction = `${smokeAction}_renamed`;
  const renameResult = (await bridge.call(
    "input_map.action",
    { action: "rename", name: smokeAction, new_name: renamedAction },
    CALL_TIMEOUT,
  )) as { success?: boolean; name?: string; old_name?: string };
  if (renameResult?.success !== true || renameResult.name !== renamedAction || renameResult.old_name !== smokeAction)
    fail(`input_map.action rename: ${JSON.stringify(renameResult)}`);
  else pass(`input_map.action rename -> name=${renamedAction}, old_name=${smokeAction}`);
  const unbindRenamed = (await bridge.call(
    "input_map.event",
    { action: "unbind", name: renamedAction, event: { type: "joypad_button", button_index: 0, device: -1 } },
    CALL_TIMEOUT,
  )) as { success?: boolean };
  if (unbindRenamed?.success !== true) fail(`input_map.event unbind after rename: ${JSON.stringify(unbindRenamed)}`);
  else pass(`input_map.event unbind joypad_button under the new name -> success (events moved)`);
  assertGuard(
    ctx,
    "input_map.action rename onto existing",
    await bridge.call(
      "input_map.action",
      { action: "rename", name: renamedAction, new_name: "ui_accept" },
      CALL_TIMEOUT,
    ),
    "ALREADY_EXISTS",
    "already exists",
  );
  // A rename onto another project action is refused like one onto a built-in.
  const otherAction = `${smokeAction}_other`;
  try {
    await bridge.call("input_map.action", { action: "add", name: otherAction }, CALL_TIMEOUT);
    assertGuard(
      ctx,
      "input_map.action rename onto a project action",
      await bridge.call(
        "input_map.action",
        { action: "rename", name: renamedAction, new_name: otherAction },
        CALL_TIMEOUT,
      ),
      "ALREADY_EXISTS",
      `action '${otherAction}' already exists`,
    );
  } finally {
    try {
      await bridge.call("input_map.action", { action: "remove", name: otherAction }, CALL_TIMEOUT);
    } catch {
      /* noop */
    }
  }
  assertGuard(
    ctx,
    "input_map.action rename onto the same name",
    await bridge.call(
      "input_map.action",
      { action: "rename", name: renamedAction, new_name: renamedAction },
      CALL_TIMEOUT,
    ),
    "INVALID_PARAMS",
    "new_name equals name",
  );
  try {
    await bridge.call("input_map.action", { action: "remove", name: renamedAction }, CALL_TIMEOUT);
  } catch {
    /* noop */
  }

  // Cleanup.
  try {
    await bridge.call("input_map.action", { action: "remove", name: smokeAction }, CALL_TIMEOUT);
  } catch {
    /* noop */
  }
  pass(`input_map.* round-trip + guards complete`);
}

/**
 * A bind on a built-in action saves the new key and keeps the joypad events of its default.
 * `ui_left` is used because its default holds a joypad button and a joypad motion, while
 * `ui_accept`'s holds keys only. The unbind runs in `finally` and must leave the default's
 * events, but project.godot then still holds a line for the action whose content equals the
 * default; the closing `revert` removes it (a toolkit without `revert` keeps the line).
 */
async function testBuiltinBindKeepsJoypadDefaults(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;
  const builtinAction = "ui_left";
  const smokeKey = { type: "key", keycode: "F9" };
  const eventClasses = async (): Promise<string[] | undefined> => {
    const result = (await bridge.call("project.get_settings", { prefix: `input/${builtinAction}` }, CALL_TIMEOUT)) as {
      settings?: unknown;
    };
    const settings = (unwrapUntrusted(result?.settings) ?? {}) as Record<string, { events?: { class?: string }[] }>;
    return settings[`input/${builtinAction}`]?.events?.map((event) => event.class ?? "?");
  };

  // Orphan pre-clean: a run that stopped before its unbind left the key bound.
  await bridge
    .call("input_map.event", { action: "unbind", name: builtinAction, event: smokeKey }, CALL_TIMEOUT)
    .catch(() => undefined);
  const classesBefore = await eventClasses();
  if (!classesBefore?.includes("InputEventJoypadButton")) {
    fail(
      `input_map.event bind F9 on ${builtinAction}: the setting holds no joypad button before the bind (${JSON.stringify(classesBefore)}); a stale input/${builtinAction} line in project.godot overrides the default, remove it and re-run`,
    );
    return;
  }
  const keyCount = (classes: string[] | undefined): number =>
    (classes ?? []).filter((eventClass) => eventClass === "InputEventKey").length;
  try {
    const bind = (await bridge.call(
      "input_map.event",
      { action: "bind", name: builtinAction, event: smokeKey },
      CALL_TIMEOUT,
    )) as { status?: string };
    const classesAfterBind = await eventClasses();
    if (bind?.status !== "created") fail(`input_map.event bind F9 on ${builtinAction}: ${JSON.stringify(bind)}`);
    else if (keyCount(classesAfterBind) !== keyCount(classesBefore) + 1)
      fail(
        `input_map.event bind F9 on ${builtinAction}: expected one more saved key than ${JSON.stringify(classesBefore)}, got ${JSON.stringify(classesAfterBind)}`,
      );
    else if (!classesAfterBind?.includes("InputEventJoypadButton"))
      fail(
        `input_map.event bind F9 on ${builtinAction}: the saved events lost the default's joypad button: ${JSON.stringify(classesAfterBind)}`,
      );
    else pass(`input_map.event bind F9 on ${builtinAction} -> the key is saved and its default's joypad events stay`);
  } finally {
    await bridge
      .call("input_map.event", { action: "unbind", name: builtinAction, event: smokeKey }, CALL_TIMEOUT)
      .catch(() => undefined);
  }
  try {
    const classesAfterUnbind = await eventClasses();
    if (JSON.stringify(classesAfterUnbind) !== JSON.stringify(classesBefore))
      fail(
        `input_map.event unbind F9 on ${builtinAction}: expected the default's events ${JSON.stringify(classesBefore)}, got ${JSON.stringify(classesAfterUnbind)}`,
      );
    else pass(`input_map.event unbind F9 on ${builtinAction} -> the setting holds its default's events again`);
  } finally {
    await bridge
      .call("input_map.action", { action: "revert", name: builtinAction }, CALL_TIMEOUT)
      .catch(() => undefined);
  }
}

interface ListedEvent {
  type?: string;
  class?: string;
  keycode?: number;
  key_kind?: string;
}

interface ListedAction {
  name?: string;
  source?: string;
  can_revert?: boolean;
  events?: ListedEvent[];
  default?: { events?: ListedEvent[] };
  status?: string;
  error?: string;
}

interface ListResult {
  actions?: ListedAction[];
  count?: number;
  error?: string;
}

/** Godot's Key values for the keys this case reads back (`core/os/keyboard.h`). */
const KEY = { SPACE: 32, ENTER: 4194309, KP_ENTER: 4194310, F9: 4194340 };

/**
 * `input_map.list` and `revert` on `ui_accept`, with the read-to-unbind round trip: a bind
 * makes the built-in differ from its default, the list shows it with its default, the
 * Enter event the list returns unbinds as it is, and `revert` puts the action back. The
 * revert in `finally` restores `ui_accept` whatever failed before it; on a toolkit without
 * `revert` it falls back to unbinding F9.
 */
async function testListRevertAndRoundTrip(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;
  const builtinAction = "ui_accept";
  const smokeKey = { type: "key", keycode: "F9" };
  const keycodes = (events: ListedEvent[] | undefined): number[] =>
    (events ?? []).filter((event) => event.type === "key").map((event) => event.keycode ?? -1);
  // A toolkit without input_map.list answers an RPC error, which the bridge throws; it is
  // caught here so each list assertion fails on its own and the section's later cases run.
  const callList = async (params: Record<string, unknown>): Promise<ListResult> =>
    ((await bridge
      .call("input_map.list", params, CALL_TIMEOUT)
      .catch((error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }))) ??
      {}) as ListResult;
  const listEntry = async (): Promise<ListedAction | undefined> => {
    const result = await callList({ name: builtinAction });
    return result.actions?.find((action) => action.name === builtinAction) ?? { error: result.error };
  };

  // Orphan pre-clean: a run that stopped before its revert left ui_accept changed.
  await bridge.call("input_map.action", { action: "revert", name: builtinAction }, CALL_TIMEOUT).catch(() => undefined);
  try {
    const bind = (await bridge.call(
      "input_map.event",
      { action: "bind", name: builtinAction, event: smokeKey },
      CALL_TIMEOUT,
    )) as { status?: string };
    if (bind?.status !== "created") fail(`input_map.event bind F9 on ${builtinAction}: ${JSON.stringify(bind)}`);

    const changed = await listEntry();
    if (
      changed?.source !== "builtin" ||
      changed.can_revert !== true ||
      !keycodes(changed.events).includes(KEY.F9) ||
      JSON.stringify(keycodes(changed.default?.events)) !== JSON.stringify([KEY.ENTER, KEY.KP_ENTER, KEY.SPACE])
    )
      fail(
        `input_map.list name=${builtinAction}: expected source=builtin, can_revert=true, F9 in events and the default Enter, Keypad Enter, Space, got ${JSON.stringify(changed)}`,
      );
    else pass(`input_map.list name=${builtinAction} -> F9 bound, can_revert=true, with its default's three keys`);

    const enter = changed?.events?.find((event) => event.type === "key" && event.keycode === KEY.ENTER);
    const unbindEnter = (await bridge.call(
      "input_map.event",
      { action: "unbind", name: builtinAction, event: enter ?? {} },
      CALL_TIMEOUT,
    )) as { success?: boolean };
    if (enter?.key_kind !== "keycode" || unbindEnter?.success !== true)
      fail(
        `input_map.event unbind with the listed Enter: expected key_kind=keycode and success, got ${JSON.stringify(enter)} -> ${JSON.stringify(unbindEnter)}`,
      );
    else
      pass(`input_map.event unbind with the Enter event input_map.list returned -> success (read event round-trips)`);

    const reverted = (await bridge.call(
      "input_map.action",
      { action: "revert", name: builtinAction },
      CALL_TIMEOUT,
    )) as ListedAction;
    if (
      reverted?.status !== "reverted" ||
      reverted.can_revert !== false ||
      JSON.stringify(keycodes(reverted.events)) !== JSON.stringify([KEY.ENTER, KEY.KP_ENTER, KEY.SPACE])
    )
      fail(
        `input_map.action revert ${builtinAction}: expected status=reverted, can_revert=false and the default's keys, got ${JSON.stringify(reverted)}`,
      );
    else pass(`input_map.action revert ${builtinAction} -> status=reverted with the default's three keys`);

    const again = (await bridge.call(
      "input_map.action",
      { action: "revert", name: builtinAction },
      CALL_TIMEOUT,
    )) as ListedAction;
    if (again?.status !== "returned")
      fail(`input_map.action revert ${builtinAction} again: expected status=returned, got ${JSON.stringify(again)}`);
    else pass(`input_map.action revert ${builtinAction} again -> status=returned`);

    const defaultSet = await callList({});
    const withBuiltins = await callList({ include_builtin: true });
    const listed = (result: ListResult): boolean =>
      result.actions?.some((action) => action.name === builtinAction) === true;
    if (
      !Array.isArray(defaultSet?.actions) ||
      defaultSet.count !== defaultSet.actions.length ||
      listed(defaultSet) ||
      !listed(withBuiltins)
    )
      fail(
        `input_map.list: expected {actions, count} without the reverted ${builtinAction}, and include_builtin adding it; got count=${JSON.stringify(defaultSet.count)}, listed=${listed(defaultSet)}, with include_builtin=${listed(withBuiltins)}${defaultSet.error ? ` (${defaultSet.error})` : ""}`,
      );
    else pass(`input_map.list -> a reverted ${builtinAction} is left out; include_builtin lists it`);
  } finally {
    const restore = (await bridge
      .call("input_map.action", { action: "revert", name: builtinAction }, CALL_TIMEOUT)
      .catch(() => undefined)) as { success?: boolean } | undefined;
    if (restore?.success !== true)
      await bridge
        .call("input_map.event", { action: "unbind", name: builtinAction, event: smokeKey }, CALL_TIMEOUT)
        .catch(() => undefined);
  }
  assertGuard(
    ctx,
    "input_map.action remove ui_accept names revert",
    await bridge.call("input_map.action", { action: "remove", name: builtinAction }, CALL_TIMEOUT),
    "INVALID_PARAMS",
    "action='revert'",
  );
}
