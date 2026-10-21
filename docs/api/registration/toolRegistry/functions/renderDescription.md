[**@npgamedev/godot-mcp-server**](../../../README.md)

***

[@npgamedev/godot-mcp-server](../../../README.md) / [registration/toolRegistry](../README.md) / renderDescription

# Function: renderDescription()

> **renderDescription**(`def`, `version`): `string`

Defined in: [src/registration/toolRegistry.ts:75](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/registration/toolRegistry.ts#L75)

The description a tool registers with: its `describe` rendering for the connected
Godot version when it has one, otherwise the static `description`. Eager and group
registration both call it, so a tool reads the same wherever it is installed.

## Parameters

### def

[`ToolDef`](../../../shared/types/type-aliases/ToolDef.md)

the tool definition

### version

[`GodotVer`](../../../shared/version/type-aliases/GodotVer.md) \| `null`

the connected Godot version, or `null` while it is not yet known

## Returns

`string`

the description text to register
