[**@npgamedev/godot-mcp-server**](../../../README.md)

***

[@npgamedev/godot-mcp-server](../../../README.md) / [shared/types](../README.md) / ErrorCode

# Type Alias: ErrorCode

> **ErrorCode** = `"ALREADY_EXISTS"` \| `"ALREADY_PLAYING"` \| `"AUTH_FAILED"` \| `"BUSY"` \| `"CANCELLED"` \| `"CLASS_MISMATCH"` \| `"CLOSED"` \| `"COMPILATION_FAILED"` \| `"CONNECT_FAILED"` \| `"CREATE_DIR_FAILED"` \| `"DELETE_FAILED"` \| `"DIR_NOT_EMPTY"` \| `"DISCONNECTED"` \| `"EDITED_SCENE"` \| `"EDITOR_VIEWPORT_UNAVAILABLE"` \| `"EMPTY_CONTENT"` \| `"EXECUTE_FAILED"` \| `"EXTERNAL_EDITOR_ACTIVE"` \| `"FAILED"` \| `"FILE_TOO_LARGE"` \| `"FILESYSTEM_NOT_READY"` \| `"FOLDER_PROTECTED"` \| `"GAME_NOT_RUNNING"` \| `"HEADLESS_UNSUPPORTED"` \| `"INTERNAL"` \| `"INVALID_CLASS"` \| `"INVALID_METHOD"` \| `"INVALID_PARAMS"` \| `"INVALID_PATH"` \| `"INVALID_STATE"` \| `"INVALID_VALUE"` \| `"LOAD_FAILED"` \| `"LOG_BUSY"` \| `"LOG_UNAVAILABLE"` \| `"LSP_UNAVAILABLE"` \| `"NO_SCENE"` \| `"NODE_NOT_FOUND"` \| `"NOT_A_RESOURCE"` \| `"NOT_BREAKED"` \| `"NOT_FOUND"` \| `"NOT_UNIQUE"` \| `"PACK_FAILED"` \| `"PARENT_NOT_FOUND"` \| `"PARSE_ERROR"` \| `"PATH_DENIED"` \| `"PATH_IN_USE"` \| `"PROPERTY_NOT_FOUND"` \| `"READ_FAILED"` \| `"RESPONSE_TOO_LARGE"` \| `"RPC_ERROR"` \| `"RUNTIME_WINDOW_MINIMIZED"` \| `"SAVE_DELETE_FAILED"` \| `"SAVE_FAILED"` \| `"SAVE_READ_FAILED"` \| `"SAVE_WRITE_FAILED"` \| `"SEND_FAILED"` \| `"SET_FAILED"` \| `"TIMEOUT"` \| `"UNKNOWN_CLASS"` \| `"UNSUPPORTED"` \| `"UNSUPPORTED_FILE_TYPE"` \| `"WRITE_FAILED"`

Defined in: [src/shared/types.ts:62](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L62)

Canonical MCP tool-error codes (UPPER_SNAKE_CASE) — the cross-repo error
contract. Must stay in sync with `MCPToolkitError.CODES` in the toolkit
(`addons/godot_mcp_toolkit/contract/mcp_toolkit_error.gd`): a new
plugin-emitted code touches both repos. Six codes originate in the server
and never travel through the plugin, so the toolkit does not list them:
`AUTH_FAILED`, `CANCELLED`, `CLOSED`, `LSP_UNAVAILABLE`, `RPC_ERROR` and
`SEND_FAILED`.
