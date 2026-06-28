[**@npgamedev/godot-mcp-server**](../../../README.md)

***

[@npgamedev/godot-mcp-server](../../../README.md) / [mcp/resources](../README.md) / registerResources

# Function: registerResources()

> **registerResources**(`server`, `bridge`): `void`

Defined in: [src/mcp/resources.ts:18](https://github.com/NPGameDev/godot-mcp-server/blob/da81f25434d6169d7009e157eb7c4765a9c98ca6/src/mcp/resources.ts#L18)

Register the read-only Godot resources (`godot://scene/{path}`,
`godot://script/{path}`, `godot://project/info`) on the server. Each fetches
live state over the bridge and degrades to an error payload if the call fails.

## Parameters

### server

`McpServer`

### bridge

[`Bridge`](../../../shared/types/interfaces/Bridge.md)

## Returns

`void`
