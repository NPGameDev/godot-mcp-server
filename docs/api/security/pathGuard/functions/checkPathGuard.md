[**@npgamedev/godot-mcp-server**](../../../README.md)

***

[@npgamedev/godot-mcp-server](../../../README.md) / [security/pathGuard](../README.md) / checkPathGuard

# Function: checkPathGuard()

> **checkPathGuard**(`g`, `value`): [`PathCheck`](../type-aliases/PathCheck.md)

Defined in: [src/security/pathGuard.ts:78](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/security/pathGuard.ts#L78)

Apply a PathGuard to an input value. Skips absent / empty / whitespace-only
values (an unprovided optional param defers to the toolkit — e.g.
editor_save_scene with no file_path = save-in-place). Validates every element
of an array param (editor_refresh.file_paths-style, if ever declared).

## Parameters

### g

[`PathGuard`](../../../shared/types/type-aliases/PathGuard.md)

### value

`unknown`

## Returns

[`PathCheck`](../type-aliases/PathCheck.md)
