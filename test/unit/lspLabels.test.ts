/**
 * Unit tests for lsp_labels.ts — pure LSP enum → label mappings plus
 * document-symbol formatting. Every function is pure (no I/O, no editor),
 * so we assert derived values directly. Label strings are read from the
 * actual map bodies, not guessed.
 */
import assert from "node:assert/strict";
import { severityLabel, symbolKindLabel, completionKindLabel, formatSymbol } from "../../src/lsp/lspLabels.js";

// ── severityLabel: concrete codes + the default/"Unknown" branch ────
{
  assert.equal(severityLabel(1), "Error");
  assert.equal(severityLabel(2), "Warning");
  assert.equal(severityLabel(3), "Information");
  assert.equal(severityLabel(4), "Hint");
  // Out-of-range severities fall through to the default branch.
  assert.equal(severityLabel(0), "Unknown");
  assert.equal(severityLabel(99), "Unknown");
}

// ── symbolKindLabel: concrete kinds + out-of-range / undefined ──────
{
  assert.equal(symbolKindLabel(1), "File");
  assert.equal(symbolKindLabel(5), "Class");
  assert.equal(symbolKindLabel(12), "Function");
  assert.equal(symbolKindLabel(26), "TypeParameter");
  // kind 0 is unmapped, 99 is out of range, undefined → kinds[0] → "Unknown".
  assert.equal(symbolKindLabel(0), "Unknown");
  assert.equal(symbolKindLabel(99), "Unknown");
  assert.equal(symbolKindLabel(undefined), "Unknown");
}

// ── completionKindLabel: concrete kinds + out-of-range / undefined ──
{
  assert.equal(completionKindLabel(1), "Text");
  assert.equal(completionKindLabel(2), "Method");
  assert.equal(completionKindLabel(25), "TypeParameter");
  assert.equal(completionKindLabel(99), "Unknown");
  assert.equal(completionKindLabel(undefined), "Unknown");
}

// ── formatSymbol: 1-based line shift + nested children recurse ──────
//
// LSP ranges are 0-based; formatSymbol shifts start/end to 1-based and
// maps the numeric kind to a label. A symbol with children recurses;
// the leaf child (no children) omits the `children` key entirely.
{
  const sym = {
    name: "Player",
    kind: 5, // Class
    range: { start: { line: 0 }, end: { line: 10 } },
    children: [{ name: "_ready", kind: 6, range: { start: { line: 2 }, end: { line: 4 } } }],
  };
  assert.deepEqual(formatSymbol(sym), {
    name: "Player",
    kind: "Class",
    start_line: 1, // 0 → 1
    end_line: 11, // 10 → 11
    children: [
      {
        name: "_ready",
        kind: "Method",
        start_line: 3, // 2 → 3
        end_line: 5, // 4 → 5
      },
    ],
  });
}

// ── formatSymbol: missing fields fall back to defaults ──────────────
{
  // No name/kind/range/children → "", "Unknown", lines default to 0+1, no children key.
  assert.deepEqual(formatSymbol({}), {
    name: "",
    kind: "Unknown",
    start_line: 1,
    end_line: 1,
  });
}

console.log("All lsp_labels tests passed.");
