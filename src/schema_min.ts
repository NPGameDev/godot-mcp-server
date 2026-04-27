/**
 * Stable serialization utility for deterministic JSON output.
 */

/**
 * Stable JSON.stringify with sorted keys for deterministic output.
 * Identical inputs produce byte-identical strings, enabling Anthropic
 * prompt-cache hits on repeat reads.
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
