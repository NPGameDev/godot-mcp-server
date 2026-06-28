[**@npgamedev/godot-mcp-server**](../../../README.md)

***

[@npgamedev/godot-mcp-server](../../../README.md) / [groups/groups](../README.md) / addExtensionGroup

# Function: addExtensionGroup()

> **addExtensionGroup**(`name`, `description`, `commands`, `keywords?`): `void`

Defined in: [src/groups/extensionGroups.ts:50](https://github.com/NPGameDev/godot-mcp-server/blob/da81f25434d6169d7009e157eb7c4765a9c98ca6/src/groups/extensionGroups.ts#L50)

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
