/**
 * Server-side feature gate — process.env check.
 *
 * Gate state is set from plugin-delivered auth/notification payloads
 * (primary) or .mcp.json env vars (fallback for old plugin versions
 * or manual edits).  isEnabled() checks process.env regardless of
 * source.  The plugin-side FeatureGate (feature_gate.gd) performs the
 * full check (deny → sidecar gate) as defence-in-depth.
 */

const FEATURE_ENV_VARS: Record<string, string> = {
  execute_code: "GODOT_MCP_ALLOW_EXECUTE_CODE",
  read_user_scope: "GODOT_MCP_ALLOW_USER_SCOPE",
  node_call_method: "GODOT_MCP_ALLOW_NODE_CALL_METHOD",
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
