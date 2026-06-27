/**
 * GroupResult status-record builders — the four named constructors for the
 * { name, status, tools, description } records that the built-in lifecycle
 * (activateGroup / reportGroupStatus in group_activation.ts) and the extension
 * lifecycle (activateExtGroup / reportExtGroupStatus in extension_groups.ts)
 * emit. Names the status intent (activated / already_loaded / available /
 * read-only-empty) at each call site and collapses the duplicated record
 * literals into one shape (concern 079).
 *
 * Pure leaf: type-imports GroupResult + ToolMeta from tool_meta.ts (type-only —
 * no runtime cycle) and imports no behavior module, so group_activation.ts and
 * extension_groups.ts can value-import these builders without a cycle.
 *
 * Byte-output-equivalent: each builder reproduces the EXACT key order + values
 * of the inline literal it replaces. The bare not-found
 * { name, status: "available", tools: [] } returns (no `description` key) stay
 * INLINE at their call sites — availableResult takes a REQUIRED description, so
 * routing them here would add a description key and change the object shape.
 */
import type { GroupResult, ToolMeta } from "./tool_meta.js";

/** A freshly-activated group: tool names map to bare { name } metas. */
export function activatedResult(name: string, toolNames: string[], description: string): GroupResult {
  return { name, status: "activated", tools: toolNames.map((t) => ({ name: t })), description };
}

/** An already-loaded group (idempotent activate / status query). */
export function alreadyLoadedResult(name: string, tools: ToolMeta[], description: string): GroupResult {
  return { name, status: "already_loaded", tools, description };
}

/** An available (not-yet-loaded) group carrying a description. */
export function availableResult(name: string, tools: ToolMeta[], description: string): GroupResult {
  return { name, status: "available", tools, description };
}

/** The shared read-only-empty result (identical string in both built-in + ext paths). */
export function readOnlyEmptyResult(name: string): GroupResult {
  return availableResult(name, [], `Group '${name}' has no tools available in read-only mode.`);
}
