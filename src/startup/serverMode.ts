/**
 * Server mode — the static registration inputs.
 *
 * Read-only state is read live via profiles.isReadOnly() at each use site: the
 * env mutates only through applyEnvUpdate (config-reload), called synchronously
 * before any read, so a live read is always current — no cache needed. The
 * module-allowed set (eager tools minus group-managed tools) is constant
 * across reloads (resolveAllowedTools() is the fixed EAGER_TOOLS set;
 * GROUP_TOOL_NAMES is immutable), so it is computed once here.
 */
import { resolveAllowedTools } from "../security/profiles.js";
import { GROUP_TOOL_NAMES } from "../groups/groups.js";

/** Eager tools minus group-managed tools — the set passed to registerBuiltinModules. Constant across reloads. */
export const MODULE_ALLOWED: Set<string> = (() => {
  const mod = new Set(resolveAllowedTools());
  for (const name of GROUP_TOOL_NAMES) mod.delete(name);
  return mod;
})();
