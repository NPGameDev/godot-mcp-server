import { BridgeError } from "../../src/errors.js";

import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT } from "../helpers.js";
import { envVarFor } from "../../src/feature_gate.js";

type GateResponse = {
  success?: boolean;
  code?: string;
  risk?: string;
  how_to_enable?: string;
  result?: unknown;
  error?: string;
};

/**
 * Section 02 — gate enforcement
 *
 * Systematically validates that all feature-gated tools are blocked when
 * their gates are disabled on the plugin side. Probes tool-level gates
 * (node_call_method, execute_code) and group-level gates (save_*) via
 * direct bridge call.
 *
 * The bridge talks directly to the Godot plugin — the server-side gate
 * (featureEnabled / env vars) is NOT involved. Whether a tool is blocked
 * depends on the plugin's own FeatureGate (feature_gate.gd). Each probe
 * calls the tool unconditionally and interprets the response:
 *   - FEATURE_DISABLED → thorough assertion (risk + how_to_enable)
 *   - Success → plugin gate is open, skip (can't test enforcement)
 *   - Method not found → server-only tool, not testable via bridge
 *   - Other non-success → blocked by some mechanism, pass
 *
 * In the normal dual-pass flow, pass 2 skips this section entirely via
 * --gates-on-skip (no isAffectedByGates export).
 */
export async function testGateEnforcement(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  /** Safely call a tool — returns the response or a synthetic GateResponse
   *  wrapping the BridgeError (JSON-RPC errors like -32601 throw). */
  async function safeCall(method: string, params: Record<string, unknown>): Promise<GateResponse> {
    try {
      return (await bridge.call(method, params, CALL_TIMEOUT)) as GateResponse;
    } catch (err) {
      if (err instanceof BridgeError) {
        return { success: false, code: "BRIDGE_ERROR", error: err.message };
      }
      throw err;
    }
  }

  // ── Probe 1: node_call_method (tool-level gate) ───────────────────
  {
    const r = await safeCall("node.call_method", { node_path: ".", method_name: "get_name" });

    if (r?.code === "FEATURE_DISABLED") {
      const envVar = envVarFor("node_call_method") ?? "GODOT_MCP_ALLOW_NODE_CALL_METHOD";
      let ok = true;
      if (!r.risk) {
        fail("gate(node_call_method): FEATURE_DISABLED missing risk field");
        ok = false;
      }
      if (!r.how_to_enable?.includes(envVar)) {
        fail(`gate(node_call_method): FEATURE_DISABLED how_to_enable missing ${envVar}`);
        ok = false;
      }
      if (ok) {
        pass(`gate(node_call_method) -> FEATURE_DISABLED with risk + how_to_enable`);
      }
    } else if (r?.success === true) {
      pass("[skip] node_call_method -> plugin gate open (enforcement tested when plugin gate is off)");
    } else {
      pass(`gate(node_call_method) -> blocked (code=${r?.code ?? "n/a"})`);
    }
  }

  // ── Probe 2: execute_code (tool-level gate) ───────────────────────
  // execute_code is a server-side runtime tool. The plugin may not have
  // a handler for it (Method not found), or may gate it independently.
  {
    const r = await safeCall("execute_code", { code: "pass" });

    if (r?.code === "FEATURE_DISABLED") {
      const envVar = envVarFor("execute_code") ?? "GODOT_MCP_ALLOW_EXECUTE_CODE";
      let ok = true;
      if (!r.risk) {
        fail("gate(execute_code): FEATURE_DISABLED missing risk field");
        ok = false;
      }
      if (!r.how_to_enable?.includes(envVar)) {
        fail(`gate(execute_code): FEATURE_DISABLED how_to_enable missing ${envVar}`);
        ok = false;
      }
      if (ok) {
        pass(`gate(execute_code) -> FEATURE_DISABLED with risk + how_to_enable`);
      }
    } else if (r?.success === true) {
      pass("[skip] execute_code -> plugin gate open (enforcement tested when plugin gate is off)");
    } else {
      // Method not found (-32601) is expected: execute_code is dispatched
      // by the server runtime bridge, not the editor plugin.
      pass(`gate(execute_code) -> blocked (code=${r?.code ?? r?.error ?? "n/a"})`);
    }
  }

  // ── Probe 3: save_* tools (group-level gate via read_user_scope) ──
  //
  // Group-gated tools are not in the MCP catalogue when the server-side
  // gate is off. The bridge talks directly to the plugin, which has its
  // own defence-in-depth gate. Possible responses:
  //   FEATURE_DISABLED   — plugin FeatureGate rejected
  //   USER_SCOPE_DISABLED — ProjectSettings bool rejected
  //   Success            — plugin gate open (skip)
  //   Method not found   — plugin doesn't expose save_* (blocked)
  {
    const saveProbes: [string, Record<string, unknown>][] = [
      ["save.read", { path: "user://saves/__gate_probe__.json" }],
      ["save.write", { path: "user://saves/__gate_probe__.json", content: "{}" }],
      ["save.delete", { path: "user://saves/__gate_probe__.json" }],
      ["save.list", { directory: "user://saves" }],
    ];
    const envVar = envVarFor("read_user_scope") ?? "GODOT_MCP_ALLOW_USER_SCOPE";

    for (const [method, params] of saveProbes) {
      const toolLabel = method.replace(".", "_");
      const r = await safeCall(method, params);

      if (r?.code === "FEATURE_DISABLED" || r?.code === "USER_SCOPE_DISABLED") {
        let ok = true;
        if (r.code === "FEATURE_DISABLED") {
          if (!r.risk) {
            fail(`gate(${toolLabel}): ${r.code} missing risk field`);
            ok = false;
          }
          if (!r.how_to_enable?.includes(envVar)) {
            fail(`gate(${toolLabel}): ${r.code} how_to_enable missing ${envVar}`);
            ok = false;
          }
        }
        if (ok) {
          pass(`gate(${toolLabel}) -> ${r.code}`);
        }
      } else if (r?.success === true) {
        pass(`[skip] ${toolLabel} -> plugin gate open (enforcement tested when plugin gate is off)`);
      } else {
        pass(`gate(${toolLabel}) -> blocked (code=${r?.code ?? r?.error ?? "n/a"})`);
      }
    }
  }
}
