[**@npgamedev/godot-mcp-server**](../../../README.md)

***

[@npgamedev/godot-mcp-server](../../../README.md) / [transport/bridge](../README.md) / BridgeOptions

# Interface: BridgeOptions

Defined in: [src/transport/bridge.ts:35](https://github.com/NPGameDev/godot-mcp-server/blob/da81f25434d6169d7009e157eb7c4765a9c98ca6/src/transport/bridge.ts#L35)

Options for bridge creation.

## Properties

### explicitEditorPort?

> `optional` **explicitEditorPort?**: `boolean`

Defined in: [src/transport/bridge.ts:43](https://github.com/NPGameDev/godot-mcp-server/blob/da81f25434d6169d7009e157eb7c4765a9c98ca6/src/transport/bridge.ts#L43)

When true, editor URL is static (GODOT_MCP_PORT set). Skips
 registry re-discovery on editor connection loss.

***

### explicitRuntimePort?

> `optional` **explicitRuntimePort?**: `string`

Defined in: [src/transport/bridge.ts:40](https://github.com/NPGameDev/godot-mcp-server/blob/da81f25434d6169d7009e157eb7c4765a9c98ca6/src/transport/bridge.ts#L40)

If set, bypass registry and use this static port for Mode B.

***

### projectPath?

> `optional` **projectPath?**: `string`

Defined in: [src/transport/bridge.ts:38](https://github.com/NPGameDev/godot-mcp-server/blob/da81f25434d6169d7009e157eb7c4765a9c98ca6/src/transport/bridge.ts#L38)

Absolute path to the Godot project. Used for registry-based port
 discovery (editor + runtime). Falls back to CWD if not set.

***

### scriptReadLimitBytes?

> `optional` **scriptReadLimitBytes?**: `number`

Defined in: [src/transport/bridge.ts:45](https://github.com/NPGameDev/godot-mcp-server/blob/da81f25434d6169d7009e157eb7c4765a9c98ca6/src/transport/bridge.ts#L45)

Max bytes for script content responses (sent to plugin via meta.set_limits).

***

### wsBufferLimitBytes?

> `optional` **wsBufferLimitBytes?**: `number`

Defined in: [src/transport/bridge.ts:47](https://github.com/NPGameDev/godot-mcp-server/blob/da81f25434d6169d7009e157eb7c4765a9c98ca6/src/transport/bridge.ts#L47)

Max WebSocket buffer size in bytes (sent to plugin via meta.set_limits).
