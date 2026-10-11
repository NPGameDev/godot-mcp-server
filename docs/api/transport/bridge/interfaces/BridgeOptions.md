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

Defined in: [src/transport/bridge.ts:56](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/transport/bridge.ts#L56)

Max bytes for script content responses: the env override for
 `mcp_toolkit/limits/script_read_cap_kb`. After every editor auth, reconnects and
 editor-port re-discoveries included, the bridge pushes its whole set of env
 overrides with `meta.set_limits`, as `{}` when neither cap is set. A 1.0.4 or
 later toolkit replaces its env overrides with each push, so `{}` clears them,
 and keeps them out of `project.godot`; the effective value is the env override
 while one is active, otherwise the project value. Older toolkits apply each
 pushed value in memory, where the next project-settings save from any source
 persists it, and ignore `{}`. When unset, the push carries no override for this
 limit.

***

### wsBufferLimitBytes?

> `optional` **wsBufferLimitBytes?**: `number`

Defined in: [src/transport/bridge.ts:62](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/transport/bridge.ts#L62)

Max WebSocket buffer size in bytes: the env override for
 `mcp_toolkit/limits/ws_buffer_kb`, pushed in the same set as the script cap. The
 plugin sizes a connection's buffers when it accepts the connection, so the
 pushed value applies only to connections accepted after the push, not to the
 one that pushed it. When unset, the push carries no override for this limit.
