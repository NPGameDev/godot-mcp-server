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

Defined in: [src/shared/types.ts:46](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L46)

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

### isHeadless()

> **isHeadless**(): `boolean` \| `undefined`

Defined in: [src/shared/types.ts:35](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L35)

Whether the connected editor runs headless (no display server), from the Mode-A
 auth handshake. `undefined` until the editor authenticates (unlike the version,
 it is never pre-populated from the registry) or when a Mode-B/older plugin omits
 it. Tools/tests branch on it to assert the deterministic headless-degraded
 responses (game.start HEADLESS_UNSUPPORTED, editor.get_console headless_hint, the
 4.4+ headless stale-instance hint).

#### Returns

`boolean` \| `undefined`

***

### waitForRuntimeConnection()?

> `optional` **waitForRuntimeConnection**(`timeoutMs`): `Promise`\<\{ `port`: `number`; \} \| `undefined`\>

Defined in: [src/shared/types.ts:43](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L43)

Wait for the playtest runtime to become reachable (game_start async gap).
 With a pinned runtime port it probes that port until the runtime answers,
 which needs neither a project path nor the registry watcher; otherwise it
 waits for the registry watcher to discover the runtime's port, and with no
 project path to watch it resolves undefined at once. Resolves with {port}
 when the runtime is reachable, undefined on timeout or bridge close.
 Optional, so a caller checks for it before waiting.

#### Parameters

##### timeoutMs

`number`

#### Returns

`Promise`\<\{ `port`: `number`; \} \| `undefined`\>
