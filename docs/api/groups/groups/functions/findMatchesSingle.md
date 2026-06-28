[**@npgamedev/godot-mcp-server**](../../../README.md)

***

[@npgamedev/godot-mcp-server](../../../README.md) / [groups/groups](../README.md) / findMatchesSingle

# Function: findMatchesSingle()

> **findMatchesSingle**(`keyword`, `readOnly`): `object`[]

Defined in: [src/groups/groupMatch.ts:62](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/groups/groupMatch.ts#L62)

Score a single keyword against all groups, apply the dominant-match filter,
and return surviving {name, score} sorted desc. Exported so the prune +
recall-preservation guardrail is directly testable.

## Parameters

### keyword

`string`

### readOnly

`boolean`

## Returns

`object`[]
