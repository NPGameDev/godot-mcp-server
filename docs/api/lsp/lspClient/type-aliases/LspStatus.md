[**@npgamedev/godot-mcp-server**](../../../README.md)

***

[@npgamedev/godot-mcp-server](../../../README.md) / [lsp/lspClient](../README.md) / LspStatus

# Type Alias: LspStatus

> **LspStatus** = `object`

Defined in: [src/lsp/lspClient.ts:131](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/lsp/lspClient.ts#L131)

The dock-facing LSP verdict for a project: whether this editor owns the LSP
port (`active`), a live peer holds it (`conflict`), or it is unreachable
(`unavailable`), with the endpoint and a human-readable detail.

## Properties

### detail

> **detail**: `string`

Defined in: [src/lsp/lspClient.ts:135](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/lsp/lspClient.ts#L135)

***

### host

> **host**: `string`

Defined in: [src/lsp/lspClient.ts:133](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/lsp/lspClient.ts#L133)

***

### port

> **port**: `number`

Defined in: [src/lsp/lspClient.ts:134](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/lsp/lspClient.ts#L134)

***

### state

> **state**: `"active"` \| `"conflict"` \| `"unavailable"`

Defined in: [src/lsp/lspClient.ts:132](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/lsp/lspClient.ts#L132)
