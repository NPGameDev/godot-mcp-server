[**@npgamedev/godot-mcp-server**](../../README.md)

***

[@npgamedev/godot-mcp-server](../../README.md) / [registry](../README.md) / lookupProject

# Function: lookupProject()

> **lookupProject**(`projectPath`): [`RegistryEntry`](../interfaces/RegistryEntry.md) \| `null`

Defined in: [src/registry.ts:122](https://github.com/NPGameDev/godot-mcp-server/blob/da81f25434d6169d7009e157eb7c4765a9c98ca6/src/registry.ts#L122)

Look up a project by its absolute path. Returns the entry or null.
The path is normalised before lookup (backslashes → forward slashes,
trailing slash stripped) so Windows CWD and GDScript registry keys match.

## Parameters

### projectPath

`string`

## Returns

[`RegistryEntry`](../interfaces/RegistryEntry.md) \| `null`
