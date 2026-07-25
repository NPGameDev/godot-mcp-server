[**@npgamedev/godot-mcp-server**](../../README.md)

***

[@npgamedev/godot-mcp-server](../../README.md) / [registry](../README.md) / watchRegistry

# Function: watchRegistry()

> **watchRegistry**(`callbacks`): `void`

Defined in: [src/registry.ts:303](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/registry.ts#L303)

Start watching projects.json for runtime port changes.

Falls back silently when fs.watch is unavailable or the file doesn't
exist yet — isWatcherActive() returns false and callRuntime uses
per-RPC file reads. The heartbeat retries watcher creation every 30s.

## Parameters

### callbacks

#### onDiscovered

(`projectPath`, `port`) => `void`

#### onRemoved

(`projectPath`) => `void`

## Returns

`void`
