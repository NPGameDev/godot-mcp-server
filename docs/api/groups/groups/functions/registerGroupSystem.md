[**@npgamedev/godot-mcp-server**](../../../README.md)

***

[@npgamedev/godot-mcp-server](../../../README.md) / [groups/groups](../README.md) / registerGroupSystem

# Function: registerGroupSystem()

> **registerGroupSystem**(`server`, `bridge`, `readOnly`): `void`

Defined in: [src/groups/groups.ts:106](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/groups/groups.ts#L106)

Register the discover_tools meta-tool and its handler.
Call this during base registration. Idempotent — if the tool
already exists, updates its description in-place (one notification);
otherwise registers fresh (also one notification).

## Parameters

### server

`McpServer`

### bridge

[`Bridge`](../../../shared/types/interfaces/Bridge.md)

### readOnly

`boolean`

## Returns

`void`
