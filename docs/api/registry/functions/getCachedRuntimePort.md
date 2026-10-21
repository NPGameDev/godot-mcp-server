[**@npgamedev/godot-mcp-server**](../../README.md)

***

[@npgamedev/godot-mcp-server](../../README.md) / [registry](../README.md) / getCachedRuntimePort

# Function: getCachedRuntimePort()

> **getCachedRuntimePort**(`projectPath`): `number` \| `null`

Defined in: [src/registry.ts:387](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/registry.ts#L387)

Read runtime_port from the in-memory cache, with no file read.
Returns null if no runtime is registered or the watcher hasn't seen one, and,
as [discoverRuntime](discoverRuntime.md) does, for an out-of-range port or a dead owning process.

## Parameters

### projectPath

`string`

## Returns

`number` \| `null`
