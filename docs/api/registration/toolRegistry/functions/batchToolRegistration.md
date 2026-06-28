[**@npgamedev/godot-mcp-server**](../../../README.md)

***

[@npgamedev/godot-mcp-server](../../../README.md) / [registration/toolRegistry](../README.md) / batchToolRegistration

# Function: batchToolRegistration()

> **batchToolRegistration**(`server`, `fn`): `void`

Defined in: [src/registration/toolRegistry.ts:79](https://github.com/NPGameDev/godot-mcp-server/blob/da81f25434d6169d7009e157eb7c4765a9c98ca6/src/registration/toolRegistry.ts#L79)

Suppress per-tool sendToolListChanged() notifications during a batch
operation, then emit a single notification at the end. Use this when
registering multiple tools in a tight loop.

## Parameters

### server

`McpServer`

### fn

() => `void`

## Returns

`void`
