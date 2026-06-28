[**@npgamedev/godot-mcp-server**](../../README.md)

***

[@npgamedev/godot-mcp-server](../../README.md) / security/pathGuard

# security/pathGuard

Syntactic filesystem-path pre-filter — a STRICT SUBSET of the toolkit's
canonicalizing FileGuard.resolve_safe / resolve_safe_user (file_guard.gd).

Purpose: fast-fail an obviously out-of-bounds path on the server (no WS
round-trip) as defense-in-depth on the npm surface. The toolkit remains the
AUTHORITATIVE boundary — it alone can globalize/simplify a path and so catch
symlink escapes; the server deliberately does not canonicalize. See ADR 0009
(toolkit) for the full trust-boundary model.

INVARIANT (strict subset): a path the toolkit would ACCEPT must NEVER be
rejected here. So this rejects only the unambiguous syntactic cases the
toolkit also rejects for every prefix — empty, an exact `..` segment,
absolute OS paths (drive letter / UNC / non-scheme leading `/`), and a
missing required prefix. Canonicalization-only escapes (symlinks) pass the
syntactic filter here and are caught downstream by the toolkit — that is the
one accepted server-allow / toolkit-deny direction; the forbidden direction
(server-deny / toolkit-allow) is what the shared subset fixture guards.

## Type Aliases

- [PathCheck](type-aliases/PathCheck.md)

## Variables

- [PROJECT\_FILE\_PATH](variables/PROJECT_FILE_PATH.md)

## Functions

- [checkPath](functions/checkPath.md)
- [checkPathGuard](functions/checkPathGuard.md)
- [guardPrefixes](functions/guardPrefixes.md)
