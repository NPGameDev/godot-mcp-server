/**
 * Server-side feature gate — process.env check.
 *
 * Gate state is set from plugin-delivered auth/notification payloads
 * (primary) or .mcp.json env vars (fallback for old plugin versions
 * or manual edits).  isEnabled() checks process.env regardless of
 * source.  The plugin-side FeatureGate (feature_gate.gd) performs the
 * full check (deny → profile → sidecar) as defence-in-depth.
 */

const FEATURE_ENV_VARS: Record<string, string> = {
  game_eval: "GODOT_MCP_ALLOW_GAME_EVAL",
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

/** Force all gates enabled. Used at startup and reload for power_user
 *  profile — power_user ignores gate flags (all always ON). */
export function enableAllGates(): void {
  for (const envVar of Object.values(FEATURE_ENV_VARS)) {
    process.env[envVar] = "1";
  }
}
