[**@npgamedev/godot-mcp-server**](../../../README.md)

***

[@npgamedev/godot-mcp-server](../../../README.md) / [groups/groups](../README.md) / addExtensionGroup

# Function: addExtensionGroup()

> **addExtensionGroup**(`name`, `description`, `commands`, `keywords?`): `void`

Defined in: [src/groups/extensionGroups.ts:44](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/groups/extensionGroups.ts#L44)

Register a deferred extension group (called from discoverExtensions). Deduplicates by method name.

## Parameters

### name

`string`

### description

`string`

### commands

[`ExtensionCmd`](../interfaces/ExtensionCmd.md)[]

### keywords?

`string`[]

## Returns

`void`
