[**@npgamedev/godot-mcp-server**](../../../README.md)

***

[@npgamedev/godot-mcp-server](../../../README.md) / [groups/groups](../README.md) / findMatchesSingle

# Function: findMatchesSingle()

> **findMatchesSingle**(`keyword`, `readOnly`): `object`[]

Defined in: [src/groups/groupMatch.ts:62](https://github.com/NPGameDev/godot-mcp-server/blob/da81f25434d6169d7009e157eb7c4765a9c98ca6/src/groups/groupMatch.ts#L62)

Score a single keyword against all groups, apply the dominant-match filter,
and return surviving {name, score} sorted desc. Exported for the §39 smoke
assertions (prune + recall-preservation guardrail).

## Parameters

### keyword

`string`

### readOnly

`boolean`

## Returns

`object`[]
