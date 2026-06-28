[**@npgamedev/godot-mcp-server**](../../README.md)

***

[@npgamedev/godot-mcp-server](../../README.md) / shared/types

# shared/types

Pure type definitions for the Godot MCP server — the leaf type module the
runtime graph depends on but which names no runtime symbol itself, so nothing
ever cycles back through it. The core wire / [Bridge](interfaces/Bridge.md) / [ErrorCode](type-aliases/ErrorCode.md)
contracts are defined here; the functions that implement them live in the
registration, dispatch, and transport modules.

## Interfaces

- [Bridge](interfaces/Bridge.md)

## Type Aliases

- [ErrorCode](type-aliases/ErrorCode.md)
- [ExtensionCmdWire](type-aliases/ExtensionCmdWire.md)
- [Hook](type-aliases/Hook.md)
- [NotificationHandler](type-aliases/NotificationHandler.md)
- [PathGuard](type-aliases/PathGuard.md)
- [ToolAnnotations](type-aliases/ToolAnnotations.md)
- [ToolDef](type-aliases/ToolDef.md)
- [ToolRequest](type-aliases/ToolRequest.md)
- [ToolTextResult](type-aliases/ToolTextResult.md)
