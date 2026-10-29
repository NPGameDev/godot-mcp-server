[**@npgamedev/godot-mcp-server**](../../README.md)

***

[@npgamedev/godot-mcp-server](../../README.md) / [registry](../README.md) / watchRegistry

# Function: watchRegistry()

> **watchRegistry**(`callbacks`): `void`

Defined in: [src/registry.ts:383](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/registry.ts#L383)

Start watching projects.json for runtime port changes.

Watches the folder that holds the file, so a registry the toolkit replaces or
creates later is still seen. Falls back silently when fs.watch is unavailable or
the folder doesn't exist yet — isWatcherActive() returns false and callRuntime
uses per-RPC file reads. The heartbeat retries watcher creation every 30s.

## Parameters

### callbacks

#### onDiscovered

(`projectPath`, `port`) => `void`

#### onRemoved

(`projectPath`) => `void`

## Returns

`void`
