[**@npgamedev/godot-mcp-server**](../../README.md)

***

[@npgamedev/godot-mcp-server](../../README.md) / [registry](../README.md) / lookupProject

# Function: lookupProject()

> **lookupProject**(`projectPath`): [`RegistryEntry`](../interfaces/RegistryEntry.md) \| `null`

Defined in: [src/registry.ts:101](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/registry.ts#L101)

Look up a project by its absolute path. Returns the entry or null.
The path is normalised before lookup (backslashes → forward slashes,
trailing slash stripped) so Windows CWD and GDScript registry keys match.

## Parameters

### projectPath

`string`

## Returns

[`RegistryEntry`](../interfaces/RegistryEntry.md) \| `null`
