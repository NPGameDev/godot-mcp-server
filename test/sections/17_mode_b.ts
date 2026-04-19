import { BridgeError } from "../../src/types.js";
import { isEnabled as featureEnabled } from "../../src/feature_gate.js";

import type { TestCtx } from "../helpers.js";
import { HOST, RUNTIME_PORT, PROBE_TIMEOUT_MS, CALL_TIMEOUT, SCREENSHOT_TIMEOUT, probePort } from "../helpers.js";

export async function testModeB(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;
  const gameEvalEnabled = featureEnabled("game_eval");

  const runtimeReachable = await probePort(HOST, RUNTIME_PORT, PROBE_TIMEOUT_MS);
  if (!runtimeReachable) {
    const modeBChecks: [string, unknown][] = [
      ["runtime.screenshot", {}],
      ["runtime.get_node_state", { node_path: "/root" }],
      ["debugger.get_log", { limit: 50 }],
      ["input.simulate", { event_type: "action", event_data: { action: "ui_accept" } }],
      ["animation_player.control", { node_path: "/root/NoSuchAP", operation: "pause" }],
    ];
    if (gameEvalEnabled) modeBChecks.push(["game.eval", { code: "1+2" }]);
    for (const [method, params] of modeBChecks) {
      try {
        await bridge.callRuntime(method, params, 3000);
        fail(`${method}: expected GAME_NOT_RUNNING when 9090 is down, but it succeeded`);
      } catch (err) {
        const code = err instanceof BridgeError ? err.code : "(unknown)";
        if (code !== "GAME_NOT_RUNNING") fail(`${method}: expected GAME_NOT_RUNNING, got ${code}`);
        else pass(`${method} -> GAME_NOT_RUNNING (game not started)`);
      }
    }
  } else {
    // Game is running — exercise the happy paths.
    const runtimeScreenshot = await bridge.callRuntime("runtime.screenshot", {}, SCREENSHOT_TIMEOUT) as { image_base64?: string; width?: number; height?: number; code?: string };
    if (!runtimeScreenshot?.image_base64) fail(`runtime.screenshot: ${JSON.stringify(runtimeScreenshot)}`);
    else {
      const buf = Buffer.from(runtimeScreenshot.image_base64, "base64");
      if (buf[0] !== 0x89 || buf[1] !== 0x50) fail("runtime.screenshot: PNG magic missing");
      else pass(`runtime.screenshot PNG ${buf.length}B (${runtimeScreenshot.width}x${runtimeScreenshot.height})`);
    }

    const nodeState = await bridge.callRuntime("runtime.get_node_state", { node_path: "/root" }, CALL_TIMEOUT) as { name?: string; class?: string; properties?: Record<string, unknown>; code?: string };
    if (!nodeState?.name || !nodeState.properties) fail(`runtime.get_node_state /root: ${JSON.stringify(nodeState)}`);
    else pass(`runtime.get_node_state /root class=${nodeState.class} props=${Object.keys(nodeState.properties).length}`);

    const debugLog = await bridge.callRuntime("debugger.get_log", { limit: 50 }, CALL_TIMEOUT) as { lines?: string[]; count?: number; total?: number; code?: string };
    if (!Array.isArray(debugLog?.lines) || typeof debugLog.count !== "number") fail(`debugger.get_log shape: ${JSON.stringify(debugLog)}`);
    else pass(`debugger.get_log -> ${debugLog.count} of ${debugLog.total} lines`);

    const inputSimulate = await bridge.callRuntime("input.simulate", { event_type: "action", event_data: { action: "ui_accept", pressed: true } }, CALL_TIMEOUT) as { ok?: boolean; code?: string };
    if (!inputSimulate?.ok) fail(`input.simulate ui_accept: ${JSON.stringify(inputSimulate)}`);
    else pass("input.simulate action=ui_accept ok");

    const animPlayerMiss = await bridge.callRuntime("animation_player.control", { node_path: "/root/NoSuchAP", operation: "pause" }, CALL_TIMEOUT) as { code?: string };
    if (animPlayerMiss?.code !== "NOT_FOUND") fail(`animation_player.control bogus: expected NOT_FOUND, got ${JSON.stringify(animPlayerMiss)}`);
    else pass("animation_player.control bogus -> NOT_FOUND");

    if (gameEvalEnabled) {
      const gameEvalResult = await bridge.callRuntime("game.eval", { code: "1+2" }, CALL_TIMEOUT) as { result?: unknown; code?: string; success?: boolean };
      if (gameEvalResult?.code === "FEATURE_DISABLED") {
        pass("game.eval -> FEATURE_DISABLED (Godot-side dual gate off; skipping)");
      } else if (gameEvalResult?.result !== 3) {
        fail(`game.eval 1+2: expected 3, got ${JSON.stringify(gameEvalResult)}`);
      } else {
        pass("game.eval 1+2 -> 3");
      }
    }
  }
}
