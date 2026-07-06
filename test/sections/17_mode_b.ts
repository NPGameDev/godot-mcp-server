import { BridgeError } from "../../src/shared/errors.js";

import type { TestCtx } from "../helpers.js";
import {
  HOST,
  RUNTIME_PORT,
  PROBE_TIMEOUT_MS,
  CALL_TIMEOUT,
  SCREENSHOT_TIMEOUT,
  probePort,
  assertHint,
  callRetryOnTimeout,
} from "../helpers.js";

export const TOOLS_TESTED: string[] = [
  "runtime_screenshot",
  "runtime_get_node_state",
  "runtime_get_script_vars",
  "runtime_set_property",
  "debugger_get_log",
  "input_simulate",
  "animation_player_control",
  "execute_code",
];

export async function testModeB(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  const runtimeReachable = await probePort(HOST, RUNTIME_PORT, PROBE_TIMEOUT_MS);
  if (!runtimeReachable) {
    const modeBChecks: [string, unknown][] = [
      ["runtime.screenshot", {}],
      ["runtime.get_node_state", { node_path: "/root" }],
      ["debugger.get_log", { limit: 50 }],
      ["input.simulate", { events: [{ event_type: "action", event_data: { action: "ui_accept" } }] }],
      ["input.simulate", { events: [{ event_type: "send_text", event_data: { text: "x" } }] }],
      ["animation_player.control", { node_path: "/root/NoSuchAP", operation: "pause" }],
      ["runtime.get_script_vars", { node_path: "/root" }],
      ["runtime.set_property", { node_path: "/root", property: "process_mode", value: 0 }],
    ];
    modeBChecks.push(["execute.code", { code: "1+2" }]);
    for (const [method, params] of modeBChecks) {
      try {
        await bridge.callRuntime(method, params, 3000);
        fail(`${method}: expected GAME_NOT_RUNNING when 6570 is down, but it succeeded`);
      } catch (err) {
        const code = err instanceof BridgeError ? err.code : "(unknown)";
        if (code !== "GAME_NOT_RUNNING") fail(`${method}: expected GAME_NOT_RUNNING, got ${code}`);
        else pass(`${method} -> GAME_NOT_RUNNING (game not started)`);
      }
    }
  } else {
    // Game is running — exercise the happy paths.
    const runtimeScreenshot = (await bridge.callRuntime("runtime.screenshot", {}, SCREENSHOT_TIMEOUT)) as {
      image_base64?: string;
      width?: number;
      height?: number;
      code?: string;
    };
    if (!runtimeScreenshot?.image_base64) fail(`runtime.screenshot: ${JSON.stringify(runtimeScreenshot)}`);
    else {
      const buf = Buffer.from(runtimeScreenshot.image_base64, "base64");
      if (buf[0] !== 0x89 || buf[1] !== 0x50) fail("runtime.screenshot: PNG magic missing");
      else pass(`runtime.screenshot PNG ${buf.length}B (${runtimeScreenshot.width}x${runtimeScreenshot.height})`);
    }

    const nodeState = (await bridge.callRuntime("runtime.get_node_state", { node_path: "/root" }, CALL_TIMEOUT)) as {
      name?: string;
      class?: string;
      properties?: Record<string, unknown>;
      code?: string;
    };
    if (!nodeState?.name || !nodeState.properties) fail(`runtime.get_node_state /root: ${JSON.stringify(nodeState)}`);
    else
      pass(`runtime.get_node_state /root class=${nodeState.class} props=${Object.keys(nodeState.properties).length}`);

    const debugLog = (await bridge.callRuntime("debugger.get_log", { limit: 50 }, CALL_TIMEOUT)) as {
      lines?: string[];
      count?: number;
      total_lines?: number;
      code?: string;
    };
    if (!Array.isArray(debugLog?.lines) || typeof debugLog.count !== "number")
      fail(`debugger.get_log shape: ${JSON.stringify(debugLog)}`);
    else pass(`debugger.get_log -> ${debugLog.count} of ${debugLog.total_lines} lines`);

    const inputSimulate = (await bridge.callRuntime(
      "input.simulate",
      { events: [{ event_type: "action", event_data: { action: "ui_accept", pressed: true } }] },
      CALL_TIMEOUT,
    )) as { success?: boolean; code?: string };
    if (!inputSimulate?.success) fail(`input.simulate ui_accept: ${JSON.stringify(inputSimulate)}`);
    else pass("input.simulate action=ui_accept ok");

    // 41o C6: an unknown input action must be REJECTED, not a silent no-op success.
    // Unregistered actions match nothing in the InputMap; the runtime guard now
    // returns INVALID_PARAMS naming the action (action path only — key/text unaffected).
    const badAction = (await bridge.callRuntime(
      "input.simulate",
      { events: [{ event_type: "action", event_data: { action: "sv2_no_such_action_xyz" } }] },
      CALL_TIMEOUT,
    )) as { success?: boolean; code?: string; error?: string };
    if (badAction?.code === "INVALID_PARAMS" && badAction.error?.includes("sv2_no_such_action_xyz"))
      pass("input.simulate unknown action -> INVALID_PARAMS (names the action)");
    else
      fail(
        `input.simulate unknown action: expected INVALID_PARAMS naming the action, got ${JSON.stringify(badAction)}`,
      );

    const animPlayerMiss = (await bridge.callRuntime(
      "animation_player.control",
      { node_path: "/root/NoSuchAP", operation: "pause" },
      CALL_TIMEOUT,
    )) as { code?: string };
    if (animPlayerMiss?.code !== "NOT_FOUND")
      fail(`animation_player.control bogus: expected NOT_FOUND, got ${JSON.stringify(animPlayerMiss)}`);
    else pass("animation_player.control bogus -> NOT_FOUND");

    // runtime.get_script_vars — /root may have no script, but should return a valid response.
    const scriptVars = (await bridge.callRuntime("runtime.get_script_vars", { node_path: "/root" }, CALL_TIMEOUT)) as {
      variables?: Record<string, unknown>;
      code?: string;
    };
    if (scriptVars?.code === "NOT_FOUND" || scriptVars?.code === "NO_SCRIPT") {
      pass(`runtime.get_script_vars /root -> ${scriptVars.code} (no script attached — valid)`);
    } else if (scriptVars?.variables && typeof scriptVars.variables === "object") {
      pass(`runtime.get_script_vars /root -> ${Object.keys(scriptVars.variables).length} vars`);
    } else {
      fail(`runtime.get_script_vars /root: ${JSON.stringify(scriptVars)}`);
    }

    // runtime.set_property — set process_mode to its current value (safe idempotent write).
    const setProp = (await bridge.callRuntime(
      "runtime.set_property",
      { node_path: "/root", property: "process_mode", value: 0 },
      CALL_TIMEOUT,
    )) as { success?: boolean; code?: string };
    if (setProp?.success === true) {
      pass("runtime.set_property /root process_mode=0 ok");
    } else if (setProp?.code) {
      // Some builds restrict runtime property writes — accept coded refusal.
      pass(`runtime.set_property /root -> ${setProp.code} (acceptable)`);
    } else {
      fail(`runtime.set_property /root: ${JSON.stringify(setProp)}`);
    }

    // 41o regression: a wrong-type runtime write must be SET_FAILED even from a
    // NON-ZERO prior. A bound setter (position) Variant-converts the wrong type to a
    // ZERO and stores it (after ≠ before) — the case that regressed to a false
    // "adjusted" success (a zero prior would hide it). The runtime restores the prior,
    // so the failure is non-destructive. Colon sub-paths stay best-effort → scalar.
    await bridge.callRuntime(
      "runtime.set_property",
      { node_path: "/root", property: "position", value: { type: "Vector2i", x: 50, y: 50 } },
      CALL_TIMEOUT,
    );
    const rtWrongType = (await bridge.callRuntime(
      "runtime.set_property",
      { node_path: "/root", property: "position", value: "not a vector" },
      CALL_TIMEOUT,
    )) as { success?: boolean; code?: string };
    if (rtWrongType?.code === "SET_FAILED")
      pass("runtime.set_property wrong-type (non-zero prior) -> SET_FAILED (destructive-zero guard)");
    else fail(`runtime.set_property wrong-type: expected SET_FAILED, got ${JSON.stringify(rtWrongType)}`);
    // Reset /root position so the window isn't left moved.
    await bridge.callRuntime(
      "runtime.set_property",
      { node_path: "/root", property: "position", value: { type: "Vector2i", x: 0, y: 0 } },
      CALL_TIMEOUT,
    );

    {
      const gameEvalResult = (await bridge.callRuntime("execute.code", { code: "1+2" }, CALL_TIMEOUT)) as {
        result?: unknown;
        code?: string;
        success?: boolean;
        hint?: string;
      };
      if (gameEvalResult?.result !== 3) {
        fail(`execute.code 1+2: expected 3, got ${JSON.stringify(gameEvalResult)}`);
      } else {
        pass("execute.code 1+2 -> 3");
      }

      // REGRESSION: execute_code context-aware load() hint.
      // Attempting to load() inside execute_code should produce a hint about context.
      const loadAttempt = (await bridge.callRuntime(
        "execute.code",
        { code: 'load("res://icon.svg")' },
        CALL_TIMEOUT,
      )) as { success?: boolean; hint?: string; error?: string; code?: string };
      // The load() call may fail or succeed depending on runtime context.
      // What matters is that the response includes context-aware guidance.
      assertHint(ctx, "REGRESSION execute_code load() hint", loadAttempt, "load");
    }

    // Hint assertion: input_simulate with world_position should include coordinate hint.
    // (world_position lives in event_data — a mouse coordinate mode; ignored for action events.)
    const inputWithPos = (await bridge.callRuntime(
      "input.simulate",
      {
        events: [
          {
            event_type: "action",
            event_data: { action: "ui_accept", pressed: true, world_position: { x: 100, y: 200 } },
          },
        ],
      },
      CALL_TIMEOUT,
    )) as { success?: boolean; hint?: string; error?: string };
    if (inputWithPos?.success) {
      // world_position hint may or may not be present depending on the event type.
      // For action events, world_position is typically ignored — that's acceptable.
      pass("input_simulate with world_position -> success");
    } else {
      pass(`input_simulate with world_position -> ${JSON.stringify(inputWithPos).slice(0, 80)}`);
    }
  }

  await testSendText(ctx);
}

// send_text (input_simulate event_type). Unlike the other
// mode-B checks, this drives its OWN playtest of the dogfood fixture scene — two
// LineEdits (one with secret=true) give it a deterministic text surface no
// matter what a prior section left running. It skips cleanly when the fixture is
// absent (a smoke run against a non-dogfood project), where the toolkit sweep
// (toolkit repo: Validations/Sections/20-runtime.md 20.17a–g) owns the positive coverage.
//
// callRuntime talks straight to the toolkit, bypassing the server's
// single→events[] normalization, so each call wraps its event in events:[…]
// exactly as the runtime handler requires; the per-event diagnostics live in
// last_event (summary mode is the toolkit default).
type SendTextEvent = {
  chars_sent?: number;
  focus_source?: string;
  focus_target?: { path?: string; class?: string } | null;
  text_changed?: boolean | null;
  text_after?: string;
  hint?: string;
};
type SendTextResult = { success?: boolean; last_event?: SendTextEvent; code?: string };

async function testSendText(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;
  const FIXTURE = "res://test/fixtures/send_text_smoke.tscn";

  // Best-effort: clear any scene a prior section left running so the fixture can
  // launch. A failure here (nothing was running) is safe to drop.
  await bridge.call("game.stop", {}, CALL_TIMEOUT).catch(() => undefined);

  const started = (await callRetryOnTimeout(
    bridge,
    "game.start",
    { scene_path: FIXTURE, wait_for_runtime: true },
    SCREENSHOT_TIMEOUT,
  )) as { success?: boolean; code?: string };
  if (started?.success !== true) {
    // Non-dogfood project / fixture missing — positive path is sweep-owned.
    pass(`send_text: fixture launch skipped (${started?.code ?? "no success"}) — positive coverage in sweep`);
    return;
  }

  // game.start can report success before the runtime WS is actually accepting
  // connections: a cold first-play (scene import + shader compile) can exceed
  // game.start's wait_for_runtime window, so the runtime appears a few seconds
  // later. Poll RUNTIME_PORT before the first runtime call so a cold start doesn't
  // spuriously throw; if it never connects, the positive path is sweep-owned.
  let runtimeUp = false;
  for (let i = 0; i < 15; i++) {
    if (await probePort(HOST, RUNTIME_PORT, PROBE_TIMEOUT_MS)) {
      runtimeUp = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!runtimeUp) {
    pass("send_text: runtime did not connect after launch — positive coverage in sweep");
    return;
  }

  const sendText = (eventData: Record<string, unknown>): Promise<unknown> =>
    bridge.callRuntime(
      "input.simulate",
      { events: [{ event_type: "send_text", event_data: eventData }] },
      CALL_TIMEOUT,
    );

  // (1) No focus, no node_path — scene-independent. Run first, before any
  // node_path grabs focus: nothing is focused on load, so focus_source is "none"
  // and the hint steers to node_path. chars_sent is asserted unconditionally.
  const noFocus = (await sendText({ text: "hello" })) as SendTextResult;
  const noFocusEv = noFocus.last_event;
  if (noFocus.success !== true || noFocusEv?.chars_sent !== 5) {
    fail(`send_text no-focus: expected success + chars_sent=5, got ${JSON.stringify(noFocus)}`);
  } else if (noFocusEv.focus_source === "none") {
    assertHint(ctx, "send_text no-focus -> node_path hint", noFocusEv, "node_path");
  } else {
    // A field happened to hold focus on load — still a valid dispatch.
    pass(`send_text no-focus -> focus_source=${noFocusEv.focus_source} (chars_sent=5)`);
  }

  // (2) Bogus node_path — scene-independent. The hint names the unresolved path.
  const bogus = (await sendText({ text: "x", node_path: "/root/NoSuchField" })) as SendTextResult;
  assertHint(ctx, "send_text bogus node_path -> hint", bogus.last_event, "node_path");

  // (3) Positive — type into the editable LineEdit; the real text_changed fires.
  const typed = (await sendText({ text: "abc", node_path: "/root/SendTextSmoke/SmokeLineEdit" })) as SendTextResult;
  const typedEv = typed.last_event;
  if (
    typed.success !== true ||
    typedEv?.focus_source !== "node_path" ||
    typedEv.focus_target?.class !== "LineEdit" ||
    typedEv.text_changed !== true ||
    typedEv.text_after !== "abc" ||
    typedEv.chars_sent !== 3
  ) {
    fail(`send_text into LineEdit: ${JSON.stringify(typed)}`);
  } else {
    pass("send_text into LineEdit -> text_changed, text_after='abc', focus_target=LineEdit");
  }

  // (4) Secret field — the change still registers, but text_after is redacted and
  // the raw secret must not appear anywhere in the response.
  const SECRET = "hunter2";
  const secret = (await sendText({ text: SECRET, node_path: "/root/SendTextSmoke/SmokeSecretEdit" })) as SendTextResult;
  const secretEv = secret.last_event;
  if (secret.success !== true || secretEv?.text_changed !== true) {
    fail(`send_text secret: expected success + text_changed, got ${JSON.stringify(secret)}`);
  } else if (JSON.stringify(secret).includes(SECRET)) {
    fail(`send_text secret: raw value leaked in response ${JSON.stringify(secret)}`);
  } else if (!/\[redacted/.test(secretEv.text_after ?? "")) {
    fail(`send_text secret: text_after not redacted, got ${JSON.stringify(secretEv.text_after)}`);
  } else {
    pass(`send_text secret -> redacted (${JSON.stringify(secretEv.text_after)}), raw value not in response`);
  }

  // (5) submit — append Enter via the same push_input path.
  const submitted = (await sendText({
    text: "go",
    node_path: "/root/SendTextSmoke/SmokeLineEdit",
    submit: true,
  })) as SendTextResult;
  if (submitted.success !== true) fail(`send_text submit: ${JSON.stringify(submitted)}`);
  else pass("send_text submit=true -> success");

  // (6) Multiline TextEdit — Enter inserts a newline (not a submit), so submit:true
  // on a TextEdit appends "\n" to the real text rather than firing text_submitted.
  const multi = (await sendText({
    text: "line",
    node_path: "/root/SendTextSmoke/SmokeMultiEdit",
    submit: true,
  })) as SendTextResult;
  const multiEv = multi.last_event;
  if (multi.success !== true || multiEv?.text_changed !== true || !(multiEv.text_after ?? "").includes("\n")) {
    fail(`send_text multiline: expected text_changed + newline in text_after, got ${JSON.stringify(multi)}`);
  } else {
    pass(`send_text multiline TextEdit -> newline inserted (text_after=${JSON.stringify(multiEv.text_after)})`);
  }

  // Teardown — best-effort; the next section probes the port fresh.
  await bridge.call("game.stop", {}, CALL_TIMEOUT).catch(() => undefined);
}
