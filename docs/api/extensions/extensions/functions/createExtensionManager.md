[**@npgamedev/godot-mcp-server**](../../../README.md)

***

[@npgamedev/godot-mcp-server](../../../README.md) / [extensions/extensions](../README.md) / createExtensionManager

# Function: createExtensionManager()

> **createExtensionManager**(`deps`): [`ExtensionManager`](../interfaces/ExtensionManager.md)

Defined in: [src/extensions/extensions.ts:43](https://github.com/NPGameDev/godot-mcp-server/blob/da81f25434d6169d7009e157eb7c4765a9c98ca6/src/extensions/extensions.ts#L43)

Construct the extension manager. getReadOnly is injected (a live read of
profiles.isReadOnly) so this module depends on no other composition module —
maximising unit-testability with a fake bridge + fake server.

## Parameters

### deps

#### bridge

[`Bridge`](../../../shared/types/interfaces/Bridge.md)

#### getReadOnly

() => `boolean`

#### server

`McpServer`

## Returns

[`ExtensionManager`](../interfaces/ExtensionManager.md)

the [ExtensionManager](../interfaces/ExtensionManager.md) facade over one shared registrar (single
  ledger), the discovery service, and the change-application service
