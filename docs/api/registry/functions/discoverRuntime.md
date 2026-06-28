[**@npgamedev/godot-mcp-server**](../../README.md)

***

[@npgamedev/godot-mcp-server](../../README.md) / [registry](../README.md) / discoverRuntime

# Function: discoverRuntime()

> **discoverRuntime**(`projectPath`): `number` \| `null`

Defined in: [src/registry.ts:132](https://github.com/NPGameDev/godot-mcp-server/blob/da81f25434d6169d7009e157eb7c4765a9c98ca6/src/registry.ts#L132)

Return the runtime_port for a project, or null if no playtest is active.
Re-reads the file on every call so newly-started playtests are picked up.

## Parameters

### projectPath

`string`

## Returns

`number` \| `null`
