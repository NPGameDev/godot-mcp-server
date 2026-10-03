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

Defined in: [src/transport/bridge.ts:54](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/transport/bridge.ts#L54)

Max bytes for script content responses. When set, it is pushed to the plugin
 (`meta.set_limits`) each time the bridge's editor connection authenticates,
 reconnects included; after an editor-port re-discovery the new connection does
 not push it. The push sets the editor's in-memory
 `mcp_toolkit/limits/script_read_cap_kb`, which stays in force until the editor
 restarts or the setting is changed, and the next project-settings save from any
 source persists it to `project.godot`. When unset, nothing is pushed and the
 project's setting applies.

***

### wsBufferLimitBytes?

> `optional` **wsBufferLimitBytes?**: `number`

Defined in: [src/transport/bridge.ts:60](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/transport/bridge.ts#L60)

Max WebSocket buffer size in bytes. When set, it is pushed the same way and sets
 `mcp_toolkit/limits/ws_buffer_kb` with the same lifetime and persistence. The
 plugin sizes a connection's buffers when it accepts the connection, so the
 pushed value applies only to connections accepted after the push, not to the
 one that pushed it. When unset, the project's setting applies.
