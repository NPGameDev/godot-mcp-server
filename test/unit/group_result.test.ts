/**
 * Unit tests for group_result.ts — the GroupResult status-record builders.
 * Pins each builder's exact record shape (deepStrictEqual) plus the
 * description-key presence subtlety that the byte-equivalence partition (concern
 * 079) relies on: every builder-produced "available" result HAS a description
 * key; only the inline not-found returns omit it.
 */
import assert from "node:assert/strict";
import { activatedResult, alreadyLoadedResult, availableResult, readOnlyEmptyResult } from "../../src/group_result.js";
import type { ToolMeta } from "../../src/tool_meta.js";

// ── activatedResult: tool names → bare { name } metas ────────────────
{
  assert.deepStrictEqual(activatedResult("g", ["a", "b"], "d"), {
    name: "g",
    status: "activated",
    tools: [{ name: "a" }, { name: "b" }],
    description: "d",
  });
  // Empty tool list → empty tools array.
  assert.deepStrictEqual(activatedResult("g", [], "d"), {
    name: "g",
    status: "activated",
    tools: [],
    description: "d",
  });
}

// ── alreadyLoadedResult: tools passed through verbatim ───────────────
{
  const tools: ToolMeta[] = [{ name: "a" }];
  assert.deepStrictEqual(alreadyLoadedResult("g", tools, "d"), {
    name: "g",
    status: "already_loaded",
    tools: [{ name: "a" }],
    description: "d",
  });
}

// ── availableResult: tools + required description ────────────────────
{
  assert.deepStrictEqual(availableResult("g", [], "d"), {
    name: "g",
    status: "available",
    tools: [],
    description: "d",
  });

  // Key-presence pin: the builder-produced "available" record ALWAYS carries a
  // description key — this is the byte-equivalence partition vs the inline
  // not-found { name, status: "available", tools: [] } returns (no description).
  assert(Object.prototype.hasOwnProperty.call(availableResult("g", [], "d"), "description") === true);
}

// ── readOnlyEmptyResult: the shared read-only-empty record ───────────
{
  assert.deepStrictEqual(readOnlyEmptyResult("g"), {
    name: "g",
    status: "available",
    tools: [],
    description: "Group 'g' has no tools available in read-only mode.",
  });
}

console.log("All group_result tests passed.");
