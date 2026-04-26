/**
 * Server-side feature gate — env-var-only.
 *
 * .mcp.json env vars are the sole source of truth for gate state.
 * The TS bridge reads env vars; the plugin-side FeatureGate
 * (feature_gate.gd) performs the full check (deny → profile → env var)
 * as defence-in-depth.
 */

const FEATURE_ENV_VARS: Record<string, string> = {
  game_eval: "GODOT_MCP_ALLOW_GAME_EVAL",
  os_execute: "GODOT_MCP_ALLOW_OS_EXECUTE",
  read_user_scope: "GODOT_MCP_ALLOW_USER_SCOPE",
  outbound_http: "GODOT_MCP_ALLOW_OUTBOUND_HTTP",
  node_call_method: "GODOT_MCP_ALLOW_NODE_CALL_METHOD",
  project_set_setting: "GODOT_MCP_ALLOW_PROJECT_SET_SETTING",
  input_map_write: "GODOT_MCP_ALLOW_INPUT_MAP_WRITE",
};

/** Check if a feature is enabled on the TS side (env-var only). */
export function isEnabled(feature: string): boolean {
  const envVar = FEATURE_ENV_VARS[feature];
  if (!envVar) return false;
  return process.env[envVar] === "1";
}

/** Get the env var name for a feature. */
export function envVarFor(feature: string): string | undefined {
  return FEATURE_ENV_VARS[feature];
}

/** List all known feature names. */
export function allFeatures(): string[] {
  return Object.keys(FEATURE_ENV_VARS);
}
