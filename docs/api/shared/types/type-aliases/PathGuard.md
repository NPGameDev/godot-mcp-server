[**@npgamedev/godot-mcp-server**](../../../README.md)

***

[@npgamedev/godot-mcp-server](../../../README.md) / [shared/types](../README.md) / PathGuard

# Type Alias: PathGuard

> **PathGuard** = \{ `guard`: `"project"` \| `"user"`; `param`: `string`; \} \| \{ `param`: `string`; `prefixes`: readonly `string`[]; \}

Defined in: [src/shared/types.ts:120](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L120)

Declares that a tool input param carries a filesystem path that the server
should syntactically pre-filter (defense-in-depth / fast-fail) before the WS
round-trip. A strict subset of the toolkit's canonicalizing FileGuard — see
src/path_guard.ts and ADR 0009 (toolkit).

`guard: "project"` ↔ res:// (FileGuard.resolve_safe); `guard: "user"` ↔ user://
(FileGuard.resolve_safe_user). Use the explicit `prefixes` form only for the
rare multi-prefix outlier (editor_screenshot.save_path).

Declare a param here ONLY if the toolkit also guards it with the same prefix
(strict-subset invariant — never reject a path the toolkit accepts). Params
the toolkit does NOT guard (source_path = absolute allowed; texture_path =
ResourceLoader res://-scoped) and scene-tree node paths (node_path,
parent_path, …) are deliberately NOT declared.
