[**@npgamedev/godot-mcp-server**](../../../README.md)

***

[@npgamedev/godot-mcp-server](../../../README.md) / [transport/bridge](../README.md) / EditorAuthHook

# Interface: EditorAuthHook

Defined in: [src/transport/bridge.ts:66](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/transport/bridge.ts#L66)

The bridge's editor-auth hook, for a consumer that only needs to react to auth.

## Methods

### onEditorAuthenticated()

> **onEditorAuthenticated**(`handler`): `void`

Defined in: [src/transport/bridge.ts:71](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/transport/bridge.ts#L71)

Register a hook fired after every successful editor auth: the first connect,
 each reconnect, and each editor-port re-discovery. The runtime channel never
 fires it. It runs synchronously inside the auth, so a handler that does I/O
 must not await it there.

#### Parameters

##### handler

() => `void`

#### Returns

`void`
