[**@npgamedev/godot-mcp-server**](../../../README.md)

***

[@npgamedev/godot-mcp-server](../../../README.md) / [shared/types](../README.md) / Bridge

# Interface: Bridge

Defined in: [src/shared/types.ts:21](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L21)

The transport facade the whole tool layer calls through — one connected Godot
editor channel plus the lazy playtest-runtime channel. Built by `createBridge`
(transport/bridge.ts); tool modules receive it and never touch sockets directly.

## Methods

### call()

> **call**(`method`, `params?`, `timeoutMs?`, `signal?`): `Promise`\<`unknown`\>

Defined in: [src/shared/types.ts:22](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L22)

#### Parameters

##### method

`string`

##### params?

`unknown`

##### timeoutMs?

`number`

##### signal?

`AbortSignal`

#### Returns

`Promise`\<`unknown`\>

***

### callRuntime()

> **callRuntime**(`method`, `params?`, `timeoutMs?`, `signal?`): `Promise`\<`unknown`\>

Defined in: [src/shared/types.ts:23](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L23)

#### Parameters

##### method

`string`

##### params?

`unknown`

##### timeoutMs?

`number`

##### signal?

`AbortSignal`

#### Returns

`Promise`\<`unknown`\>

***

### clearRuntime()?

> `optional` **clearRuntime**(): `void`

Defined in: [src/shared/types.ts:36](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L36)

Proactively tear down the runtime channel (e.g. on game_stopped notification).
 Next callRuntime() will fail immediately with GAME_NOT_RUNNING.

#### Returns

`void`

***

### close()

> **close**(): `Promise`\<`void`\>

Defined in: [src/shared/types.ts:24](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L24)

#### Returns

`Promise`\<`void`\>

***

### getGodotVersion()

> **getGodotVersion**(): [`GodotVer`](../../version/type-aliases/GodotVer.md) \| `undefined`

Defined in: [src/shared/types.ts:28](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L28)

Parsed Godot version as [major, minor] tuple from the registry or auth, or undefined if unknown.

#### Returns

[`GodotVer`](../../version/type-aliases/GodotVer.md) \| `undefined`

***

### getGodotVersionString()

> **getGodotVersionString**(): `string` \| `undefined`

Defined in: [src/shared/types.ts:26](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L26)

Godot version string from the plugin auth handshake (e.g. "4.5.2"), or undefined if not yet connected / older plugin.

#### Returns

`string` \| `undefined`

***

### waitForRuntimeConnection()?

> `optional` **waitForRuntimeConnection**(`timeoutMs`): `Promise`\<\{ `port`: `number`; \} \| `undefined`\>

Defined in: [src/shared/types.ts:33](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L33)

Wait for a runtime port to appear in the registry (game_start async gap).
 Resolves with {port} on discovery, undefined on timeout. Optional — only
 available when the bridge was created with a projectPath and registry
 watcher.

#### Parameters

##### timeoutMs

`number`

#### Returns

`Promise`\<\{ `port`: `number`; \} \| `undefined`\>
