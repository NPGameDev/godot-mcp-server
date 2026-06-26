/**
 * Server mode — the live, reload-refreshed registration inputs.
 *
 * Holds the read-only flag and the module-allowed set (standard tools minus
 * group-managed tools) as a thin cache over the stateless profiles.ts readers.
 * refreshMode() recomputes both from the (possibly just-reloaded) env; it runs
 * once at boot and again after each applyEnvUpdate (inside the live config
 * reload), so every registration site reads a consistent snapshot via the
 * getters.
 */
import { resolveAllowedTools, isReadOnly } from "./profiles.js";
import { GROUP_TOOL_NAMES } from "./groups.js";

// Cached registration inputs — mutated ONLY by refreshMode(), which runs before
// any getReadOnly()/getModuleAllowed() read (at boot, immediately after
// warnDeprecatedEnvVars). The placeholders are never observed.
let readOnly = false;
let moduleAllowed = new Set<string>();

function buildAllowedTools(): Set<string> {
  return resolveAllowedTools();
}

/** Subtract group-managed tools → set used by module register(). */
function buildModuleAllowed(allowed: Set<string>): Set<string> {
  const mod = new Set(allowed);
  for (const name of GROUP_TOOL_NAMES) mod.delete(name);
  return mod;
}

/**
 * Re-read the read-only flag from the (possibly just-reloaded) env and recompute
 * the module-allowed set. Call once at boot and again after each applyEnvUpdate
 * (inside the live config reload).
 */
export function refreshMode(): void {
  readOnly = isReadOnly();
  const allowedTools = buildAllowedTools();
  moduleAllowed = buildModuleAllowed(allowedTools);
}

/** Live read-only flag (the cache; named getReadOnly to disambiguate from profiles.isReadOnly). */
export function getReadOnly(): boolean {
  return readOnly;
}

/** Standard tools minus group-managed tools — the set passed to registerBuiltinModules. */
export function getModuleAllowed(): Set<string> {
  return moduleAllowed;
}
