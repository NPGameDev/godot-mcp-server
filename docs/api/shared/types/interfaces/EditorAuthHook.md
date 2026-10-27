[**@npgamedev/godot-mcp-server**](../../../README.md)

***

[@npgamedev/godot-mcp-server](../../../README.md) / [shared/types](../README.md) / EditorAuthHook

# Interface: EditorAuthHook

Defined in: [src/shared/types.ts:50](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L50)

The bridge's editor-auth hook, for a consumer that only needs to react to auth.

## Methods

### onEditorAuthenticated()

> **onEditorAuthenticated**(`handler`): `void`

Defined in: [src/shared/types.ts:57](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L57)

Register a hook fired after every successful editor auth that reports a Godot
 version (every current plugin does): the first connect,
 each reconnect, and each editor-port re-discovery. The runtime channel never
 fires it. It runs synchronously inside the auth, so a handler that does I/O
 must not await it there. A handler that throws fails the auth, so it must not
 throw.

#### Parameters

##### handler

() => `void`

#### Returns

`void`
