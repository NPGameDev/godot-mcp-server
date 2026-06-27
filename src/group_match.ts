/**
 * Group keyword matching — the query → scored → dominant-filtered → capped
 * scoring pipeline behind discover_tools' fuzzy search. Scores a keyword against
 * every built-in group (via the GROUPS catalogue) and every extension group (via
 * the extension_groups accessor), applies the recall-biased dominant-match
 * filter, and caps the fuzzy result set (3 per keyword, 5 total). Also coerces
 * the raw request param to a string[]. Pure leaf — no SDK, no registration, no
 * module state. Extracted from groups.ts (concern 077, C2).
 */
import { GROUPS, allDefs } from "./group_catalogue.js";
import { extensionGroupEntries } from "./extension_groups.js";
import { isAllowedInReadOnly } from "./profiles.js";

// ── Keyword matching ────────────────────────────────────────────────

// Substring matching requires query.length >= 3 to avoid noisy 1-2 char
// matches. Short domain terms ("2d", "3d", "ui", "ai") must be added as
// explicit exact-match keywords in the group definition.
function matchKeywords(query: string, keywords: string[]): number {
  let score = 0;
  for (const kw of keywords) {
    if (query === kw) score += 3;
    else if (query.includes(kw)) score += 2;
    else if (kw.includes(query) && query.length >= 3) score += 1;
  }
  return score;
}

// Recall-biased dominant-match filter (Item C, 41m-sexies). A multi-word query
// substring-matches several unrelated groups' single keywords (+2 each) while
// the intended group scores far higher; admitting those incidental matches
// bloats the tool context. Drop candidates below this fraction of the top score
// — but NEVER hide a valid group (over-activation is the safe failure direction;
// it is clearer for the LLM to receive extra groups and reset them than to have
// a valid group withheld). Safeguards: keep top-1 always, inclusive boundary,
// and exempt exact keyword/tool-name matches.
const DOMINANT_MATCH_RATIO = 0.5;

/**
 * Score a single keyword against all groups, apply the dominant-match filter,
 * and return surviving {name, score} sorted desc. Exported for the §39 smoke
 * assertions (prune + recall-preservation guardrail).
 */
export function findMatchesSingle(keyword: string, readOnly: boolean): { name: string; score: number }[] {
  const q = keyword.toLowerCase();
  const matches: { name: string; score: number; exact: boolean }[] = [];

  for (const group of GROUPS) {
    if (readOnly) {
      const hasReadOnlyTool = group.tools.some((t) => {
        const d = allDefs.get(t);
        return d ? isAllowedInReadOnly(d.annotations) : false;
      });
      if (!hasReadOnlyTool) continue;
    }
    let score = matchKeywords(q, group.keywords);
    let exact = group.keywords.includes(q);
    for (const toolName of group.tools) {
      const norm = toolName.replace(/_/g, " ");
      if (norm.includes(q) && q.length >= 3) score += 1;
      if (toolName === q || norm === q) exact = true;
    }
    if (score > 0) matches.push({ name: group.name, score, exact });
  }

  for (const [name, ext] of extensionGroupEntries()) {
    if (readOnly) {
      const hasReadOnly = ext.commands.some((c) => isAllowedInReadOnly(c.annotations));
      if (!hasReadOnly) continue;
    }
    let score = 0;
    let exact = ext.keywords.includes(q);
    if (ext.keywords.length > 0) {
      score += matchKeywords(q, ext.keywords);
    }
    const descTokens = (ext.description || name).toLowerCase().split(/\s+/);
    for (const tok of descTokens) {
      if (q === tok) score += 2;
      else if (tok.includes(q) && q.length >= 3) score += 1;
    }
    for (const cmd of ext.commands) {
      const norm = cmd.toolName.replace(/_/g, " ");
      if (norm.includes(q) && q.length >= 3) score += 1;
      if (cmd.toolName === q || norm === q) exact = true;
    }
    if (score > 0) matches.push({ name, score, exact });
  }

  matches.sort((a, b) => b.score - a.score);

  // Apply the dominant-match filter. matches[0] is the top score (sorted desc).
  // Keep: the top match (i === 0), any exact match (exempt), and anything within
  // DOMINANT_MATCH_RATIO of the top (inclusive >=). Single-keyword queries cluster
  // within 2× so they survive intact; only the multi-word-phrase noise is pruned.
  let kept = matches;
  if (matches.length > 1) {
    const cutoff = matches[0].score * DOMINANT_MATCH_RATIO;
    kept = matches.filter((m, i) => i === 0 || m.exact || m.score >= cutoff);
  }
  return kept.map((m) => ({ name: m.name, score: m.score }));
}

const FUZZY_PER_ELEMENT_CAP = 3;
const FUZZY_TOTAL_CAP = 5;

/**
 * Cap fuzzy results: 3 per keyword, 5 total.
 * Round-robin top-1 per keyword first (each keyword gets representation),
 * then fill remaining slots by score.
 */
export function capFuzzyResults(perKeyword: Map<string, { name: string; score: number }[]>): {
  selected: string[];
  additionalCount: number;
} {
  // Per-element cap: keep top-3 per keyword.
  const cappedPerKeyword = new Map<string, { name: string; score: number }[]>();
  for (const [keyword, matches] of perKeyword) {
    cappedPerKeyword.set(keyword, matches.slice(0, FUZZY_PER_ELEMENT_CAP));
  }

  // Collect all unique candidates (for counting truncation).
  const allUnique = new Set<string>();
  for (const matches of perKeyword.values()) {
    for (const m of matches) allUnique.add(m.name);
  }

  // Round 1: top-1 per keyword (round-robin ensures each keyword gets representation).
  const selected = new Set<string>();
  const selectedList: string[] = [];
  for (const [, matches] of cappedPerKeyword) {
    if (selectedList.length >= FUZZY_TOTAL_CAP) break;
    const best = matches.find((m) => !selected.has(m.name));
    if (best) {
      selected.add(best.name);
      selectedList.push(best.name);
    }
  }

  // Round 2: fill remaining from all capped matches by aggregate score.
  const remaining = new Map<string, number>();
  for (const matches of cappedPerKeyword.values()) {
    for (const m of matches) {
      if (selected.has(m.name)) continue;
      remaining.set(m.name, (remaining.get(m.name) ?? 0) + m.score);
    }
  }
  const sorted = [...remaining.entries()].sort((a, b) => b[1] - a[1]);
  for (const [name] of sorted) {
    if (selectedList.length >= FUZZY_TOTAL_CAP) break;
    selected.add(name);
    selectedList.push(name);
  }

  return { selected: selectedList, additionalCount: allUnique.size - selected.size };
}

/** Coerce request param to string[]. Handles stringified JSON arrays. */
export function coerceRequest(raw: string | string[]): string[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string" && raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      /* fall through */
    }
  }
  return [raw];
}
