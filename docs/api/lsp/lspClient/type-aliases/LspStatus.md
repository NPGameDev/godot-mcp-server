[**@npgamedev/godot-mcp-server**](../../../README.md)

***

[@npgamedev/godot-mcp-server](../../../README.md) / [lsp/lspClient](../README.md) / LspStatus

# Type Alias: LspStatus

> **LspStatus** = `object`

Defined in: [src/lsp/lspClient.ts:150](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/lsp/lspClient.ts#L150)

The dock-facing LSP verdict for a project: whether this editor owns the LSP
port (`active`), a live peer holds it (`conflict`), or it is unreachable
(`unavailable`), with the endpoint and a human-readable detail.

## Properties

### detail

> **detail**: `string`

Defined in: [src/lsp/lspClient.ts:154](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/lsp/lspClient.ts#L154)

***

### host

> **host**: `string`

Defined in: [src/lsp/lspClient.ts:152](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/lsp/lspClient.ts#L152)

***

### port

> **port**: `number`

Defined in: [src/lsp/lspClient.ts:153](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/lsp/lspClient.ts#L153)

***

### state

> **state**: `"active"` \| `"conflict"` \| `"unavailable"`

Defined in: [src/lsp/lspClient.ts:151](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/lsp/lspClient.ts#L151)
