/**
 * Syntactic filesystem-path pre-filter — a STRICT SUBSET of the toolkit's
 * canonicalizing FileGuard.resolve_safe / resolve_safe_user (file_guard.gd).
 *
 * Purpose: fast-fail an obviously out-of-bounds path on the server (no WS
 * round-trip) as defense-in-depth on the npm surface. The toolkit remains the
 * AUTHORITATIVE boundary — it alone can globalize/simplify a path and so catch
 * symlink escapes; the server deliberately does not canonicalize. See ADR 0009
 * (toolkit) for the full trust-boundary model.
 *
 * INVARIANT (strict subset): a path the toolkit would ACCEPT must NEVER be
 * rejected here. So this rejects only the unambiguous syntactic cases the
 * toolkit also rejects for every prefix — empty, an exact `..` segment,
 * absolute OS paths (drive letter / UNC / non-scheme leading `/`), and a
 * missing required prefix. Canonicalization-only escapes (symlinks) pass the
 * syntactic filter here and are caught downstream by the toolkit — that is the
 * one accepted server-allow / toolkit-deny direction; the forbidden direction
 * (server-deny / toolkit-allow) is what the shared subset fixture guards.
 */
import type { PathGuard } from "../shared/types.js";

/** Convenience: the ubiquitous `file_path → res://` declaration. */
export const PROJECT_FILE_PATH: PathGuard = { param: "file_path", guard: "project" };

/** Resolve a PathGuard's allowed prefixes. */
export function guardPrefixes(g: PathGuard): readonly string[] {
  if ("prefixes" in g) return g.prefixes;
  return g.guard === "user" ? ["user://"] : ["res://"];
}

export type PathCheck = { ok: true } | { ok: false; reason: string };

/**
 * Validate a single path string against the allowed prefixes — the syntactic
 * half of FileGuard.resolve_safe. Empty/whitespace is rejected here (the
 * validator contract); callers that treat an absent optional param as "skip"
 * use checkPathGuard, which defers empties to the toolkit instead.
 */
export function checkPath(input: string, prefixes: readonly string[]): PathCheck {
  if (input.trim().length === 0) return { ok: false, reason: "empty path" };
  const normalized = input.replace(/\\/g, "/");

  // Reject exact `..` segments (directory traversal). Match the SEGMENT, never
  // a substring — so `a..b` and `a.b.c` pass (the classic over-block bug).
  for (const seg of normalized.split("/")) {
    if (seg === "..") return { ok: false, reason: `path contains '..': ${input}` };
  }

  // Reject absolute OS paths: drive letter (`X:`), then any leading `/` that
  // is not the res://‑/user:// scheme. After `\`→`/`, UNC `\\host\share`
  // becomes `//host/share` and is caught by the leading-`/` rule.
  if (normalized.length >= 2 && normalized[1] === ":") {
    return { ok: false, reason: `absolute OS path: ${input}` };
  }
  if (normalized.startsWith("/") && !normalized.startsWith("res://") && !normalized.startsWith("user://")) {
    return { ok: false, reason: `absolute OS path: ${input}` };
  }

  // Require an allowed prefix.
  if (!prefixes.some((p) => normalized.startsWith(p))) {
    return { ok: false, reason: `path must start with one of [${prefixes.join(", ")}] (got ${input})` };
  }
  return { ok: true };
}

/**
 * Apply a PathGuard to an input value. Skips absent / empty / whitespace-only
 * values (an unprovided optional param defers to the toolkit — e.g.
 * editor_save_scene with no file_path = save-in-place). Validates every element
 * of an array param (editor_refresh.file_paths-style, if ever declared).
 */
export function checkPathGuard(g: PathGuard, value: unknown): PathCheck {
  const prefixes = guardPrefixes(g);
  const values = Array.isArray(value) ? value : [value];
  for (const v of values) {
    if (typeof v !== "string" || v.trim().length === 0) continue; // absent/empty → defer to toolkit
    const r = checkPath(v, prefixes);
    if (!r.ok) return r;
  }
  return { ok: true };
}

/**
 * Shared subset fixture — the SAME path cases are mirrored in the toolkit's
 * FileGuard unit-test group. This file is the source of truth; keep the
 * GDScript mirror in sync. The cross-repo invariant the duplication
 * enforces: NO path is server-deny / toolkit-allow (a false rejection). Both
 * suites assert their own guard against `allow` (→ ok) and `deny` (→ rejected).
 *
 * Note: canonicalization-only escapes (symlinks) are NOT here — they can't be
 * expressed syntactically; the server allows them and the toolkit denies them
 * (the accepted direction), exercised at the smoke/manual layer.
 */
export const PATH_FIXTURE = {
  /** [path, prefixes] both layers must ALLOW (no false rejections). */
  allow: [
    ["res://x.gd", ["res://"]],
    ["res://a/b/c.tscn", ["res://"]],
    ["res://addons/foo/bar.gd", ["res://"]],
    ["res://my..thing/x.gd", ["res://"]], // dots, not an exact `..` segment
    ["res://a.b.c/d.gd", ["res://"]],
    ["res://a/b/", ["res://"]], // trailing-slash dir
    ["user://saves/x.json", ["user://"]],
    ["user://screenshots/shot.png", ["res://", "user://screenshots/"]],
    ["res://shot.png", ["res://", "user://screenshots/"]],
  ] as const,
  /** [path, prefixes] both layers must DENY (no escapes). */
  deny: [
    ["res://../escape.gd", ["res://"]],
    ["res://a/../../../escape", ["res://"]],
    ["../../etc/passwd", ["res://"]],
    ["/etc/passwd", ["res://"]],
    ["C:/Windows/x", ["res://"]],
    ["\\\\server\\share\\x", ["res://"]], // UNC
    ["random/x.gd", ["res://"]], // non-allowed prefix
    ["file:///etc/passwd", ["res://"]],
    ["user://x.json", ["res://"]], // wrong prefix for a project tool
    ["res://x.gd", ["user://"]], // wrong prefix for a user tool
    ["", ["res://"]], // empty
  ] as const,
} as const;
