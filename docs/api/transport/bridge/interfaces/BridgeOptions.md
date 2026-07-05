[**@npgamedev/godot-mcp-server**](../../../README.md)

***

[@npgamedev/godot-mcp-server](../../../README.md) / [transport/bridge](../README.md) / BridgeOptions

# Interface: BridgeOptions

Defined in: [src/transport/bridge.ts:36](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/transport/bridge.ts#L36)

Options for bridge creation.

## Properties

### explicitEditorPort?

> `optional` **explicitEditorPort?**: `boolean`

Defined in: [src/transport/bridge.ts:45](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/transport/bridge.ts#L45)

When true, editor URL is a pin (GODOT_MCP_EDITOR_PORT / --editor-port set).
 Skips registry re-discovery on editor connection loss and, on a pinned
 connect or auth-handshake failure, runs the fail-fast desync cross-check.

***

### explicitRuntimePort?

> `optional` **explicitRuntimePort?**: `string`

Defined in: [src/transport/bridge.ts:41](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/transport/bridge.ts#L41)

If set, bypass registry and use this static port for Mode B.

***

### projectPath?

> `optional` **projectPath?**: `string`

Defined in: [src/transport/bridge.ts:39](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/transport/bridge.ts#L39)

Absolute path to the Godot project. Used for registry-based port
 discovery (editor + runtime). Falls back to CWD if not set.

***

### scriptReadLimitBytes?

> `optional` **scriptReadLimitBytes?**: `number`

Defined in: [src/transport/bridge.ts:47](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/transport/bridge.ts#L47)

Max bytes for script content responses (sent to plugin via meta.set_limits).

***

### wsBufferLimitBytes?

> `optional` **wsBufferLimitBytes?**: `number`

Defined in: [src/transport/bridge.ts:49](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/transport/bridge.ts#L49)

Max WebSocket buffer size in bytes (sent to plugin via meta.set_limits).
