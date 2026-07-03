[**@npgamedev/godot-mcp-server**](../../../README.md)

***

[@npgamedev/godot-mcp-server](../../../README.md) / [transport/bridge](../README.md) / BridgeOptions

# Interface: BridgeOptions

Defined in: [src/transport/bridge.ts:35](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/transport/bridge.ts#L35)

Options for bridge creation.

## Properties

### explicitEditorPort?

> `optional` **explicitEditorPort?**: `boolean`

Defined in: [src/transport/bridge.ts:44](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/transport/bridge.ts#L44)

When true, editor URL is a pin (GODOT_MCP_EDITOR_PORT / --editor-port set).
 Skips registry re-discovery on editor connection loss and, on a pinned
 connect or auth-handshake failure, runs the fail-fast desync cross-check.

***

### explicitRuntimePort?

> `optional` **explicitRuntimePort?**: `string`

Defined in: [src/transport/bridge.ts:40](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/transport/bridge.ts#L40)

If set, bypass registry and use this static port for Mode B.

***

### projectPath?

> `optional` **projectPath?**: `string`

Defined in: [src/transport/bridge.ts:38](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/transport/bridge.ts#L38)

Absolute path to the Godot project. Used for registry-based port
 discovery (editor + runtime). Falls back to CWD if not set.

***

### scriptReadLimitBytes?

> `optional` **scriptReadLimitBytes?**: `number`

Defined in: [src/transport/bridge.ts:46](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/transport/bridge.ts#L46)

Max bytes for script content responses (sent to plugin via meta.set_limits).

***

### wsBufferLimitBytes?

> `optional` **wsBufferLimitBytes?**: `number`

Defined in: [src/transport/bridge.ts:48](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/transport/bridge.ts#L48)

Max WebSocket buffer size in bytes (sent to plugin via meta.set_limits).
