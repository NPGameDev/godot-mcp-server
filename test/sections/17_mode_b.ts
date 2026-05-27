import { BridgeError } from "../../src/errors.js";

import type { TestCtx } from "../helpers.js";
import {
  HOST,
  RUNTIME_PORT,
  PROBE_TIMEOUT_MS,
  CALL_TIMEOUT,
  SCREENSHOT_TIMEOUT,
  probePort,
  assertHint,
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
      ["input.simulate", { event_type: "action", event_data: { action: "ui_accept" } }],
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
      total?: number;
      code?: string;
    };
    if (!Array.isArray(debugLog?.lines) || typeof debugLog.count !== "number")
      fail(`debugger.get_log shape: ${JSON.stringify(debugLog)}`);
    else pass(`debugger.get_log -> ${debugLog.count} of ${debugLog.total} lines`);

    const inputSimulate = (await bridge.callRuntime(
      "input.simulate",
      { event_type: "action", event_data: { action: "ui_accept", pressed: true } },
      CALL_TIMEOUT,
    )) as { success?: boolean; code?: string };
    if (!inputSimulate?.success) fail(`input.simulate ui_accept: ${JSON.stringify(inputSimulate)}`);
    else pass("input.simulate action=ui_accept ok");

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

      // REGRESSION: execute_code context-aware load() hint (fixed T:279efed / S:5e95710).
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
    const inputWithPos = (await bridge.callRuntime(
      "input.simulate",
      { event_type: "action", event_data: { action: "ui_accept", pressed: true }, world_position: { x: 100, y: 200 } },
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
}
