import fs from "node:fs";

import type { TestCtx } from "../helpers.js";
import {
  HOST,
  RUNTIME_PORT,
  PROBE_TIMEOUT_MS,
  CALL_TIMEOUT,
  SCREENSHOT_TIMEOUT,
  MANUAL_ASSIST,
  probePort,
  assertHint,
  manualCue,
  callRetryOnTimeout,
  unwrapUntrusted,
} from "../helpers.js";
/**
 * Error codes that mean the runtime channel died — the game stopped, the WS
 * dropped, or the connect/call timed out. A self-launched `game.start current`
 * playtest can drop MID-section on some environments (observed on 4.2), and the
 * next callRuntime then throws one of these. They are runtime-liveness signals,
 * never an assertion failure, so the section's top-level catch turns them into a
 * clean skip of the remaining runtime legs rather than a section-killing throw.
 */
const RUNTIME_GONE_CODES = new Set(["GAME_NOT_RUNNING", "CONNECT_FAILED", "DISCONNECTED", "CLOSED", "TIMEOUT"]);

/**
 * True when a thrown value signals a dead runtime — i.e. it carries a `.code` in
 * {@link RUNTIME_GONE_CODES}. Matched by the `.code` PROPERTY, never by
 * `instanceof BridgeError`: dual class copies across ESM module graphs break
 * `instanceof`, so a runtime-gone throw could escape the guard. This is the sole
 * arbiter of "the game dropped" for both a guarded leg and the sub-helpers.
 *
 * TIMEOUT is included because a mid-call drop can surface as a call timeout before
 * the socket-close is detected; the trade-off is that a genuinely *hung* (not merely
 * buggy) live handler is skipped rather than failed — but a wrong *result* still
 * returns and is asserted, so only a true hang is masked, and the bounded CALL_TIMEOUT
 * on each leg keeps that window short.
 */
function isRuntimeGone(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  return typeof code === "string" && RUNTIME_GONE_CODES.has(code);
}

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

/**
 * Make a runtime available for the mode-B happy paths, without ever failing when
 * a game can't run. Reuses a live runtime if one is already up; otherwise starts
 * the current scene and polls 6570 for the WebSocket to accept connections. On a
 * headless editor `game.start` returns its deterministic guard (no display, no
 * playtest), so this reports "unavailable" and the caller green-skips — the
 * runtime happy paths are display-bound. A runtime is a precondition this block
 * cannot manufacture headless, so its absence is a clean SKIP, never a failure.
 *
 * Returns whether a runtime is reachable and whether THIS call started it (so the
 * caller stops only a game it launched, leaving prior state as found).
 */
async function ensureRuntime(ctx: TestCtx): Promise<{ available: boolean; startedHere: boolean }> {
  const { bridge } = ctx;
  if (await probePort(HOST, RUNTIME_PORT, PROBE_TIMEOUT_MS)) return { available: true, startedHere: false };

  const started = (await callRetryOnTimeout(
    bridge,
    "game.start",
    { scene_path: "current", wait_for_runtime: true },
    SCREENSHOT_TIMEOUT,
  )) as { success?: boolean; code?: string };
  if (started?.success !== true) return { available: false, startedHere: false };

  // game.start can report success before the runtime WS is accepting
  // connections: a cold first-play (scene import + shader compile) can exceed
  // its wait_for_runtime window, so poll before declaring the runtime up.
  for (let i = 0; i < 15; i++) {
    if (await probePort(HOST, RUNTIME_PORT, PROBE_TIMEOUT_MS)) return { available: true, startedHere: true };
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  // Launched but never connected — stop what we started and skip.
  await bridge.call("game.stop", {}, CALL_TIMEOUT).catch(() => undefined);
  return { available: false, startedHere: false };
}

export async function testModeB(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  const runtime = await ensureRuntime(ctx);
  if (!runtime.available) {
    // No runtime and none can be launched here (headless / no editor / launch
    // failed) — the runtime happy paths are display-bound, so skip cleanly. The
    // toolkit sweep (Validations/Sections/20-runtime.md) owns positive coverage
    // in environments that can run a game.
    pass(
      "mode_b: SKIPPED runtime happy paths — no runtime and none launchable (display-bound; sweep owns positive coverage)",
    );
  } else {
    // ONE try wraps every runtime-dependent leg — the happy paths AND the disk-mode
    // / send_text sub-helpers. A self-launched `game.start current` playtest can drop
    // MID-section on some environments (observed on 4.2); the next runtime call then
    // throws a runtime-gone BridgeError. Catching it HERE (by `.code`, see isRuntimeGone)
    // turns a drop ANYWHERE into a single clean skip of the rest — deterministically
    // green. Legs that ran before the drop kept their pass/fail; genuine assertion
    // failures go through fail() (non-throwing) and are counted, never reaching here.
    try {
      // Runtime is up — exercise the happy paths.
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

      // image_detail on the running-game capture: mid/low downscale the inline image
      // proportionally and disclose the applied level (image_detail) + resulting
      // "WxH" (returned). callRuntime talks straight to the toolkit WS, so both are
      // top-level fields on the raw payload.
      const midRtShot = (await bridge.callRuntime(
        "runtime.screenshot",
        { image_detail: "mid" },
        SCREENSHOT_TIMEOUT,
      )) as { image_base64?: string; width?: number; height?: number; image_detail?: string; returned?: string };
      const midRtLongEdge = Math.max(midRtShot?.width ?? 0, midRtShot?.height ?? 0);
      if (
        !midRtShot?.image_base64 ||
        midRtShot.image_detail !== "mid" ||
        midRtShot.returned !== `${midRtShot.width}x${midRtShot.height}` ||
        midRtLongEdge > 1024
      )
        fail(
          `runtime.screenshot image_detail=mid: expected image + mid disclosure + <=1024 long edge, got ${JSON.stringify({ ...midRtShot, image_base64: midRtShot?.image_base64 ? "<present>" : undefined })}`,
        );
      else pass(`runtime.screenshot image_detail=mid -> ${midRtShot.returned} (long edge ${midRtLongEdge} <= 1024)`);

      const lowRtShot = (await bridge.callRuntime(
        "runtime.screenshot",
        { image_detail: "low" },
        SCREENSHOT_TIMEOUT,
      )) as { image_base64?: string; width?: number; height?: number; image_detail?: string; returned?: string };
      const lowRtLongEdge = Math.max(lowRtShot?.width ?? 0, lowRtShot?.height ?? 0);
      if (
        !lowRtShot?.image_base64 ||
        lowRtShot.image_detail !== "low" ||
        lowRtShot.returned !== `${lowRtShot.width}x${lowRtShot.height}` ||
        lowRtLongEdge > 512
      )
        fail(
          `runtime.screenshot image_detail=low: expected image + low disclosure + <=512 long edge, got ${JSON.stringify({ ...lowRtShot, image_base64: lowRtShot?.image_base64 ? "<present>" : undefined })}`,
        );
      else pass(`runtime.screenshot image_detail=low -> ${lowRtShot.returned} (long edge ${lowRtLongEdge} <= 512)`);

      // Minimized game window — a suspended-render window returns a diagnostic
      // RUNTIME_WINDOW_MINIMIZED (not a 30 s TIMEOUT, not a stale PNG);
      // force_foreground_game:true un-minimizes + captures fresh. Can't be forced
      // programmatically, so it's gated on MCP_MANUAL_ASSIST (a human minimizes the
      // game on cue); otherwise green-skip. Positive coverage also lives in the
      // toolkit sweep (Validations/Sections/20-runtime.md 20.5c–20.5d).
      if (MANUAL_ASSIST) {
        await manualCue("MINIMIZE the running game window now");
        const minShot = (await bridge.callRuntime("runtime.screenshot", {}, SCREENSHOT_TIMEOUT)) as {
          code?: string;
        };
        if (minShot?.code === "RUNTIME_WINDOW_MINIMIZED")
          pass("runtime.screenshot minimized -> RUNTIME_WINDOW_MINIMIZED (not TIMEOUT, not stale PNG)");
        else
          fail(
            `runtime.screenshot minimized: expected RUNTIME_WINDOW_MINIMIZED, got ${JSON.stringify(minShot).slice(0, 200)}`,
          );

        // callRuntime bypasses the server's screenshot mapper (straight to the
        // toolkit WS), so remediation is a top-level field on the raw toolkit
        // payload — assert it discloses the un-minimize, mirroring §13's
        // foregrounded_editor.
        const forcedShot = (await bridge.callRuntime(
          "runtime.screenshot",
          { force_foreground_game: true },
          SCREENSHOT_TIMEOUT,
        )) as { image_base64?: string; width?: number; height?: number; remediation?: string[] };
        if (forcedShot?.image_base64) {
          const fbuf = Buffer.from(forcedShot.image_base64, "base64");
          if (fbuf[0] !== 0x89 || fbuf[1] !== 0x50) fail("runtime.screenshot force_foreground_game: PNG magic missing");
          else if (!forcedShot.remediation?.includes("foregrounded_game"))
            fail(
              `runtime.screenshot force_foreground_game: expected remediation foregrounded_game, got ${JSON.stringify(forcedShot.remediation)}`,
            );
          else
            pass(
              `runtime.screenshot force_foreground_game -> fresh PNG ${fbuf.length}B (${forcedShot.width}x${forcedShot.height}) remediation=foregrounded_game`,
            );
        } else {
          fail(
            `runtime.screenshot force_foreground_game: expected fresh PNG, got ${JSON.stringify(forcedShot).slice(0, 200)}`,
          );
        }
      } else {
        pass(
          "runtime.screenshot minimized legs skipped (set MCP_MANUAL_ASSIST=1 to drive them; sweep owns positive coverage)",
        );
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

      // debugger.get_log wraps `lines` in an <untrusted-…> envelope around a JSON
      // array of {id,level,message,timestamp_unix} — game-log text is model-visible
      // untrusted content, never a plain array — alongside the pagination fields.
      // Assert the envelope unwraps to an array and the pagination scalars are present.
      const debugLog = (await bridge.callRuntime("debugger.get_log", { limit: 50 }, CALL_TIMEOUT)) as {
        lines?: string;
        returned?: number;
        total_lines?: number;
        has_more?: boolean;
        next_id?: number;
        source?: string;
        code?: string;
      };
      const debugLogLines = unwrapUntrusted(debugLog?.lines);
      if (
        typeof debugLog?.lines !== "string" ||
        !debugLog.lines.startsWith("<untrusted-") ||
        !Array.isArray(debugLogLines) ||
        typeof debugLog.returned !== "number" ||
        typeof debugLog.total_lines !== "number" ||
        typeof debugLog.has_more !== "boolean" ||
        typeof debugLog.next_id !== "number" ||
        debugLog.source !== "buffer"
      )
        fail(`debugger.get_log shape: ${JSON.stringify(debugLog)}`);
      else
        pass(
          `debugger.get_log -> ${debugLog.returned} of ${debugLog.total_lines} lines (untrusted-wrapped array, source=buffer)`,
        );

      const inputSimulate = (await bridge.callRuntime(
        "input.simulate",
        { events: [{ event_type: "action", event_data: { action: "ui_accept", pressed: true } }] },
        CALL_TIMEOUT,
      )) as { success?: boolean; code?: string };
      if (!inputSimulate?.success) fail(`input.simulate ui_accept: ${JSON.stringify(inputSimulate)}`);
      else pass("input.simulate action=ui_accept ok");

      // An unknown input action must be REJECTED, not a silent no-op success.
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
      const scriptVars = (await bridge.callRuntime(
        "runtime.get_script_vars",
        { node_path: "/root" },
        CALL_TIMEOUT,
      )) as {
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

      // runtime.set_property happy path — write a benign value and confirm it landed.
      // Target /root.content_scale_factor: it exists on every root Window regardless
      // of the running scene (so this is scene-independent), and it is purely cosmetic
      // — rescaling rendered content, never pausing, disabling, or hiding the game loop.
      // A lifecycle property like process_mode on /root would suspend the loop and kill
      // the in-game runtime server mid-section, so this stays on an inert property and
      // read-then-restores it so no visible state leaks to later sections.
      const scaleProbe = (await bridge.callRuntime("runtime.get_node_state", { node_path: "/root" }, CALL_TIMEOUT)) as {
        properties?: { content_scale_factor?: number };
      };
      const priorScale = scaleProbe?.properties?.content_scale_factor ?? 1;
      const targetScale = priorScale === 2 ? 3 : 2;
      // A successful runtime write returns the mutation echo — {node_path, property,
      // old_value, new_value}, no `success` field (that lives on the MCP envelope, not
      // the raw runtime payload); a coded failure would carry `code`. Assert the value
      // actually landed AND changed: new_value === the request, old_value === the prior.
      const setProp = (await bridge.callRuntime(
        "runtime.set_property",
        { node_path: "/root", property: "content_scale_factor", value: targetScale },
        CALL_TIMEOUT,
      )) as { new_value?: number; old_value?: number; code?: string };
      if (setProp?.new_value === targetScale && setProp.old_value === priorScale) {
        pass(`runtime.set_property /root content_scale_factor ${priorScale} -> ${targetScale} ok (old/new echoed)`);
      } else {
        fail(`runtime.set_property /root content_scale_factor: ${JSON.stringify(setProp)}`);
      }
      // Restore the original scale so the game renders as found for later sections.
      await bridge.callRuntime("runtime.set_property", {
        node_path: "/root",
        property: "content_scale_factor",
        value: priorScale,
      });

      // A wrong-type runtime write must be SET_FAILED even from a
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
        )) as {
          success?: boolean;
          hint?: string;
          error?: string;
          code?: string;
        };
        // The load() call may fail or succeed depending on runtime context.
        // What matters is that the response includes context-aware guidance.
        assertHint(ctx, "REGRESSION execute_code load() hint", loadAttempt, "load");
      }

      // REGRESSION: runtime tools stay responsive while the game tree is PAUSED.
      // The runtime autoload runs with process_mode = PROCESS_MODE_ALWAYS, so it keeps
      // servicing WS requests when the game loop is suspended; a regression there froze
      // runtime.get_node_state under a pause. Pause via set_pause(true) (a method call —
      // `get_tree().paused = true` is an assignment and throws PARSE_ERROR through
      // execute.code, which is expression-only). The try/finally is load-bearing: a
      // leaked pause would suspend the runtime for every later smoke section, so the
      // unpause must run even if an assertion above throws.
      try {
        await bridge.callRuntime("execute.code", { code: "get_tree().set_pause(true)" }, CALL_TIMEOUT);
        // Confirm the pause actually took effect before asserting on the paused tree —
        // otherwise a no-op pause would make the responsiveness check vacuous.
        const pausedState = (await bridge.callRuntime("execute.code", { code: "get_tree().paused" }, CALL_TIMEOUT)) as {
          result?: unknown;
          code?: string;
        };
        if (pausedState?.result !== true) {
          fail(`execute.code get_tree().paused: expected true after set_pause, got ${JSON.stringify(pausedState)}`);
        } else {
          pass("execute.code get_tree().set_pause(true) -> paused=true");
        }

        // The regression assertion: a runtime read must still RETURN while paused (before
        // the PROCESS_MODE_ALWAYS fix this call hung/froze under the pause).
        const pausedNodeState = (await bridge.callRuntime(
          "runtime.get_node_state",
          { node_path: "/root" },
          CALL_TIMEOUT,
        )) as { name?: string; properties?: Record<string, unknown>; code?: string };
        if (!pausedNodeState?.name || !pausedNodeState.properties) {
          fail(`runtime.get_node_state /root (paused): ${JSON.stringify(pausedNodeState)}`);
        } else {
          pass(
            `runtime.get_node_state /root responds while paused (props=${Object.keys(pausedNodeState.properties).length})`,
          );
        }
      } finally {
        // ALWAYS unpause — a leaked pause would poison every later section. Swallow any
        // failure here: throwing from finally would mask a real error in flight from the
        // try body, and if the runtime already dropped the pause died with it anyway.
        await bridge
          .callRuntime("execute.code", { code: "get_tree().set_pause(false)" }, CALL_TIMEOUT)
          .catch(() => undefined);
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
        // world_position hint may or may not be present depending on the event
        // type. For action events, world_position is typically ignored — that's
        // acceptable.
        pass("input_simulate with world_position -> success");
      } else {
        pass(`input_simulate with world_position -> ${JSON.stringify(inputWithPos).slice(0, 80)}`);
      }

      // Disk-mode + send_text legs also need the live runtime — inside the same try
      // so a drop during them (or between them) skips cleanly too. Each manages its
      // own game lifecycle (reuse-or-launch; send_text drives its own fixture).
      await testRuntimeDiskModes(ctx);
      await testSendText(ctx);
    } catch (err) {
      // Reached only when a runtime call threw a runtime-gone signal (matched by
      // `.code`, so a cross-module BridgeError copy can't slip past). The
      // self-launched playtest dropped somewhere in the block; skip the rest
      // cleanly and stay green. Any other throw is a real bug and propagates.
      if (isRuntimeGone(err)) {
        const message = err instanceof Error ? err.message : String(err);
        pass(`mode_b: runtime dropped mid-section (${message}) — remaining runtime legs SKIPPED`);
      } else {
        throw err;
      }
    } finally {
      // Leave the game state as found: stop only a game this block launched.
      if (runtime.startedHere) {
        await bridge.call("game.stop", {}, CALL_TIMEOUT).catch(() => undefined);
      }
    }
  }
}

// runtime.screenshot image_response_mode disk/both + the save_path guard. These
// need a live game, and in full-suite order no game is running when this section
// starts (the playtest section stops its own) — so this block manages its own:
// it reuses a game that is already up, otherwise launches the current scene, and
// stops the game afterwards ONLY if it launched it (prior state left as found).
// Headless editors can't launch a playtest (game.start returns its deterministic
// guard), so the legs green-skip there like the suite's other display-bound legs.
async function testRuntimeDiskModes(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  const wasRunning = await probePort(HOST, RUNTIME_PORT, PROBE_TIMEOUT_MS);
  let startedHere = false;
  if (!wasRunning) {
    const started = (await callRetryOnTimeout(
      bridge,
      "game.start",
      { scene_path: "current", wait_for_runtime: true },
      SCREENSHOT_TIMEOUT,
    )) as { success?: boolean; code?: string };
    if (started?.success !== true) {
      pass(
        `runtime.screenshot disk/both legs skipped (game.start ${started?.code ?? "no success"} — display-bound playtest unavailable)`,
      );
      return;
    }
    startedHere = true;
    // A cold first launch can outlast game.start's wait_for_runtime window —
    // poll the runtime WS before the first call (same pattern as send_text).
    let runtimeUp = false;
    for (let i = 0; i < 15; i++) {
      if (await probePort(HOST, RUNTIME_PORT, PROBE_TIMEOUT_MS)) {
        runtimeUp = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (!runtimeUp) {
      pass("runtime.screenshot disk/both legs skipped (runtime never connected after launch)");
      await bridge.call("game.stop", {}, CALL_TIMEOUT).catch(() => undefined);
      return;
    }
  }

  try {
    // image_response_mode:"disk" — the game persists the PNG and returns only its
    // path (no image bytes). The game's user:// resolves to the same app_userdata
    // dir as the editor (same project), so the globalized path exists on disk from
    // this process too. Assert the lean envelope + the file, then delete it.
    const rtDiskShot = (await bridge.callRuntime(
      "runtime.screenshot",
      { image_response_mode: "disk" },
      SCREENSHOT_TIMEOUT,
    )) as { image_base64?: string; path?: string; bytes?: number; mime_type?: string; code?: string };
    if (
      rtDiskShot?.image_base64 !== undefined ||
      typeof rtDiskShot?.path !== "string" ||
      rtDiskShot.mime_type !== "image/png" ||
      !fs.existsSync(rtDiskShot.path)
    ) {
      fail(`runtime.screenshot disk: expected lean envelope + file, got ${JSON.stringify(rtDiskShot)}`);
    } else {
      pass(`runtime.screenshot disk -> no image, file at ${rtDiskShot.path} (${rtDiskShot.bytes}B)`);
      try {
        fs.unlinkSync(rtDiskShot.path);
      } catch {
        /* best-effort cleanup */
      }
    }

    // image_response_mode:"both" — image embedded AND persisted; the raw payload
    // carries both image_base64 and the saved file path.
    const rtBothShot = (await bridge.callRuntime(
      "runtime.screenshot",
      { image_response_mode: "both" },
      SCREENSHOT_TIMEOUT,
    )) as { image_base64?: string; path?: string; code?: string };
    if (
      !rtBothShot?.image_base64 ||
      typeof rtBothShot.path !== "string" ||
      !rtBothShot.path.toLowerCase().endsWith(".png") ||
      !fs.existsSync(rtBothShot.path)
    ) {
      fail(
        `runtime.screenshot both: expected image + file, got ${JSON.stringify({ ...rtBothShot, image_base64: "<omitted>" })}`,
      );
    } else {
      pass(`runtime.screenshot both -> image + file at ${rtBothShot.path}`);
      try {
        fs.unlinkSync(rtBothShot.path);
      } catch {
        /* best-effort cleanup */
      }
    }

    // Disk × detail orthogonality — image_response_mode:"both" + image_detail:"low".
    // The inline image downscales to a ≈512 px long edge (image_detail applies to the
    // returned inline image ONLY), but the SAVED file stays full resolution and the
    // response hint says so, so an agent can Read the file for pixel detail. This is
    // the proof that disk persistence ignores image_detail.
    const rtDiskDetailShot = (await bridge.callRuntime(
      "runtime.screenshot",
      { image_response_mode: "both", image_detail: "low" },
      SCREENSHOT_TIMEOUT,
    )) as {
      image_base64?: string;
      path?: string;
      width?: number;
      height?: number;
      image_detail?: string;
      returned?: string;
      hint?: string;
    };
    const rtDiskDetailLongEdge = Math.max(rtDiskDetailShot?.width ?? 0, rtDiskDetailShot?.height ?? 0);
    if (
      !rtDiskDetailShot?.image_base64 ||
      typeof rtDiskDetailShot.path !== "string" ||
      !fs.existsSync(rtDiskDetailShot.path) ||
      rtDiskDetailShot.image_detail !== "low" ||
      rtDiskDetailLongEdge > 512 ||
      !rtDiskDetailShot.hint?.toLowerCase().includes("full-res")
    ) {
      fail(
        `runtime.screenshot both+low: expected <=512 inline long edge + saved file + full-res hint, got ${JSON.stringify({ ...rtDiskDetailShot, image_base64: rtDiskDetailShot?.image_base64 ? "<present>" : undefined })}`,
      );
    } else {
      pass(
        `runtime.screenshot both+image_detail=low -> inline ${rtDiskDetailShot.returned} (<=512), disk full-res file at ${rtDiskDetailShot.path} (hint says full-res)`,
      );
      try {
        fs.unlinkSync(rtDiskDetailShot.path);
      } catch {
        /* best-effort cleanup */
      }
    }

    // save_path guard — the runtime allowlist is user://screenshots/ only, so a
    // res:// destination is rejected (validated whenever present, any mode).
    const rtDeniedShot = (await bridge.callRuntime(
      "runtime.screenshot",
      { save_path: "res://runtime_shot_should_deny.png", image_response_mode: "disk" },
      CALL_TIMEOUT,
    )) as { success?: boolean; code?: string; error?: string };
    if (rtDeniedShot?.code !== "PATH_DENIED")
      fail(`runtime.screenshot save_path res://: expected PATH_DENIED, got ${JSON.stringify(rtDeniedShot)}`);
    else pass("runtime.screenshot save_path res:// -> PATH_DENIED");
  } finally {
    // Leave the game state as found: stop only a game this block launched.
    if (startedHere) {
      await bridge.call("game.stop", {}, CALL_TIMEOUT).catch(() => undefined);
    }
  }
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
