[**@npgamedev/godot-mcp-server**](../../../README.md)

***

[@npgamedev/godot-mcp-server](../../../README.md) / [extensions/extensions](../README.md) / ExtensionManager

# Interface: ExtensionManager

Defined in: [src/extensions/extensions.ts:24](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/extensions/extensions.ts#L24)

The extension subsystem facade — see module header for the owned lifecycle.

## Methods

### discoverEagerly()

> **discoverEagerly**(`deadlineMs?`): `Promise`\<\{ `timedOut`: `boolean`; \}\>

Defined in: [src/extensions/extensions.ts:30](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/extensions/extensions.ts#L30)

Eager boot discovery wrapped in the discovery deadline; resolves {timedOut}.

#### Parameters

##### deadlineMs?

`number`

#### Returns

`Promise`\<\{ `timedOut`: `boolean`; \}\>

***

### discoverExtensions()

> **discoverExtensions**(): `Promise`\<`void`\>

Defined in: [src/extensions/extensions.ts:28](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/extensions/extensions.ts#L28)

Discover + register extensions (single-flight: a concurrent caller joins the in-flight pass).

#### Returns

`Promise`\<`void`\>

***

### handleExtensionsChanged()

> **handleExtensionsChanged**(`params?`): `void`

Defined in: [src/extensions/extensions.ts:32](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/extensions/extensions.ts#L32)

Reconcile the tool list from an extensions.changed push (add/remove/readonly-transition).

#### Parameters

##### params?

`Record`\<`string`, `unknown`\>

#### Returns

`void`

***

### registerRefreshTool()

> **registerRefreshTool**(): `void`

Defined in: [src/extensions/extensions.ts:26](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/extensions/extensions.ts#L26)

Register the always-on extensions_refresh tool (self-guards via hasToolRef).

#### Returns

`void`
