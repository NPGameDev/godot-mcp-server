/**
 * Stable serialization utility for deterministic JSON output.
 */

/**
 * Stable JSON.stringify with sorted keys: identical inputs produce
 * byte-identical strings.
 *
 * Where this earns prompt-cache hits is the re-sent schema/tools block —
 * stable key order keeps that whole-request payload byte-identical across
 * turns, so Anthropic's cache matches it. A per-call tool response is
 * serialized exactly once into history, so sorting its keys buys no extra
 * cache hit; it is retained there for output stability (a tool's response
 * keys don't reorder between otherwise-identical calls).
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, sortedReplacer);
}

function sortedReplacer(_key: string, value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[k] = (value as Record<string, unknown>)[k];
    }
    return sorted;
  }
  return value;
}
