[**@npgamedev/godot-mcp-server**](../../../README.md)

***

[@npgamedev/godot-mcp-server](../../../README.md) / [lsp/lspClient](../README.md) / LspStatus

# Type Alias: LspStatus

> **LspStatus** = `object`

Defined in: [src/lsp/lspClient.ts:159](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/lsp/lspClient.ts#L159)

The dock-facing LSP verdict for a project: whether this editor owns the LSP
port (`active`), a live peer holds it (`conflict`), or it is unreachable
(`unavailable`), with the endpoint and a human-readable detail.

## Properties

### detail

> **detail**: `string`

Defined in: [src/lsp/lspClient.ts:163](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/lsp/lspClient.ts#L163)

***

### host

> **host**: `string`

Defined in: [src/lsp/lspClient.ts:161](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/lsp/lspClient.ts#L161)

***

### port

> **port**: `number`

Defined in: [src/lsp/lspClient.ts:162](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/lsp/lspClient.ts#L162)

***

### state

> **state**: `"active"` \| `"conflict"` \| `"unavailable"`

Defined in: [src/lsp/lspClient.ts:160](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/lsp/lspClient.ts#L160)
