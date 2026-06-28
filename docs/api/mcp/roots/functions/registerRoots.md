[**@npgamedev/godot-mcp-server**](../../../README.md)

***

[@npgamedev/godot-mcp-server](../../../README.md) / [mcp/roots](../README.md) / registerRoots

# Function: registerRoots()

> **registerRoots**(`server`): `void`

Defined in: [src/mcp/roots.ts:37](https://github.com/NPGameDev/godot-mcp-server/blob/da81f25434d6169d7009e157eb7c4765a9c98ca6/src/mcp/roots.ts#L37)

Register a `godot://roots` resource that returns the project root(s).
This lets MCP clients discover what Godot project this server is
connected to without relying on the client's own root list.

## Parameters

### server

`McpServer`

## Returns

`void`
