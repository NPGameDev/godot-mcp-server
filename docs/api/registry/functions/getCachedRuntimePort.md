[**@npgamedev/godot-mcp-server**](../../README.md)

***

[@npgamedev/godot-mcp-server](../../README.md) / [registry](../README.md) / getCachedRuntimePort

# Function: getCachedRuntimePort()

> **getCachedRuntimePort**(`projectPath`): `number` \| `null`

Defined in: [src/registry.ts:339](https://github.com/NPGameDev/godot-mcp-server/blob/da81f25434d6169d7009e157eb7c4765a9c98ca6/src/registry.ts#L339)

Read runtime_port from the in-memory cache (zero I/O).
Returns null if no runtime is registered or the watcher hasn't seen one.

## Parameters

### projectPath

`string`

## Returns

`number` \| `null`
