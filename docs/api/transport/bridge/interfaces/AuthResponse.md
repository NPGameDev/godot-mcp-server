[**@npgamedev/godot-mcp-server**](../../../README.md)

***

[@npgamedev/godot-mcp-server](../../../README.md) / [transport/bridge](../README.md) / AuthResponse

# Interface: AuthResponse

Defined in: [src/transport/authHandshake.ts:24](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/transport/authHandshake.ts#L24)

Parsed auth response from the Godot plugin.

## Properties

### godotVersion

> **godotVersion**: `string` \| `undefined`

Defined in: [src/transport/authHandshake.ts:25](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/transport/authHandshake.ts#L25)

***

### headless

> **headless**: `boolean` \| `undefined`

Defined in: [src/transport/authHandshake.ts:31](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/transport/authHandshake.ts#L31)

Whether the editor runs headless (no display server), from the Mode-A ack's
 `headless` field. `undefined` when the ack omits it (Mode-B runtime, which
 sends a bare `{authed:true}`, or a pre-handshake plugin) — the same missing →
 undefined mapping the version fields use.

***

### minServer

> **minServer**: `string` \| `undefined`

Defined in: [src/transport/authHandshake.ts:34](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/transport/authHandshake.ts#L34)

The toolkit's declared minimum server (major.minor), from the ack's `min_server`;
 undefined on a 1.0.x toolkit (it predates the floor) and on a runtime ack.

***

### toolkitVersion

> **toolkitVersion**: `string` \| `undefined`

Defined in: [src/transport/authHandshake.ts:26](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/transport/authHandshake.ts#L26)
