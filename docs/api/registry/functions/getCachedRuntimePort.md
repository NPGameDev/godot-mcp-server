[**@npgamedev/godot-mcp-server**](../../README.md)

***

[@npgamedev/godot-mcp-server](../../README.md) / [registry](../README.md) / getCachedRuntimePort

# Function: getCachedRuntimePort()

> **getCachedRuntimePort**(`projectPath`): `number` \| `null`

Defined in: [src/registry.ts:335](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/registry.ts#L335)

Read runtime_port from the in-memory cache (zero I/O).
Returns null if no runtime is registered or the watcher hasn't seen one.

## Parameters

### projectPath

`string`

## Returns

`number` \| `null`
