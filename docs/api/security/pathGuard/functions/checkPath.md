[**@npgamedev/godot-mcp-server**](../../../README.md)

***

[@npgamedev/godot-mcp-server](../../../README.md) / [security/pathGuard](../README.md) / checkPath

# Function: checkPath()

> **checkPath**(`input`, `prefixes`): [`PathCheck`](../type-aliases/PathCheck.md)

Defined in: [src/security/pathGuard.ts:45](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/security/pathGuard.ts#L45)

Validate a single path string against the allowed prefixes — the syntactic
half of FileGuard.resolve_safe. Empty/whitespace is rejected here (the
validator contract); callers that treat an absent optional param as "skip"
use checkPathGuard, which defers empties to the toolkit instead.

## Parameters

### input

`string`

### prefixes

readonly `string`[]

## Returns

[`PathCheck`](../type-aliases/PathCheck.md)
