[**@npgamedev/godot-mcp-server**](../../../README.md)

***

[@npgamedev/godot-mcp-server](../../../README.md) / [shared/types](../README.md) / ErrorCode

# Type Alias: ErrorCode

> **ErrorCode** = `"ALREADY_EXISTS"` \| `"ALREADY_PLAYING"` \| `"AUTH_FAILED"` \| `"CANCELLED"` \| `"CLOSED"` \| `"COMPILATION_FAILED"` \| `"CONNECT_FAILED"` \| `"CREATE_DIR_FAILED"` \| `"DELETE_FAILED"` \| `"DIR_NOT_EMPTY"` \| `"DISCONNECTED"` \| `"EDITED_SCENE"` \| `"EDITOR_VIEWPORT_UNAVAILABLE"` \| `"EXECUTE_FAILED"` \| `"EXTERNAL_EDITOR_ACTIVE"` \| `"FILE_TOO_LARGE"` \| `"FILESYSTEM_NOT_READY"` \| `"FOLDER_PROTECTED"` \| `"GAME_NOT_RUNNING"` \| `"INTERNAL"` \| `"INVALID_CLASS"` \| `"INVALID_METHOD"` \| `"LSP_UNAVAILABLE"` \| `"INVALID_PARAMS"` \| `"INVALID_PATH"` \| `"LOAD_FAILED"` \| `"LOG_BUSY"` \| `"LOG_UNAVAILABLE"` \| `"NO_SCENE"` \| `"NOT_A_RESOURCE"` \| `"NOT_FOUND"` \| `"NOT_UNIQUE"` \| `"PACK_FAILED"` \| `"PARENT_NOT_FOUND"` \| `"PARSE_ERROR"` \| `"PATH_DENIED"` \| `"PATH_IN_USE"` \| `"READ_FAILED"` \| `"RPC_ERROR"` \| `"RUNTIME_WINDOW_MINIMIZED"` \| `"SAVE_DELETE_FAILED"` \| `"SAVE_FAILED"` \| `"SAVE_READ_FAILED"` \| `"SAVE_WRITE_FAILED"` \| `"SEND_FAILED"` \| `"TIMEOUT"` \| `"UNSUPPORTED"` \| `"NOT_BREAKED"` \| `"UNSUPPORTED_FILE_TYPE"` \| `"WRITE_FAILED"`

Defined in: [src/shared/types.ts:61](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L61)

Canonical MCP tool-error codes (UPPER_SNAKE_CASE) — the cross-repo error
contract. Must stay in sync with `MCPToolkitError.CODES` in the toolkit
(`addons/godot_mcp_toolkit/contract/mcp_toolkit_error.gd`): a new
plugin-emitted code touches both repos. The transport-level codes
(`AUTH_FAILED`, `CLOSED`, `RPC_ERROR`, `SEND_FAILED`) originate in the
bridge and never travel through the plugin.
