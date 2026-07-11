[**@npgamedev/godot-mcp-server**](../../../README.md)

***

[@npgamedev/godot-mcp-server](../../../README.md) / [lsp/lspSession](../README.md) / withLspDoc

# Function: withLspDoc()

> **withLspDoc**(`filePath`, `projectPath`): `Promise`\<[`ToolTextResult`](../../../shared/types/type-aliases/ToolTextResult.md) \| \{ `client`: [`LspClient`](../../lspClient/classes/LspClient.md); `uri`: `string`; \}\>

Defined in: [src/lsp/lspSession.ts:155](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/lsp/lspSession.ts#L155)

The shared LSP-tool prologue, folded into a single call: validate the path,
ensure the LSP connection, then open the document. Returns the connected
client together with the opened document URI, or the first error result
(checked in order: path → connect → open). Every LSP handler runs this before
issuing its request.

## Parameters

### filePath

`string`

### projectPath

`string`

## Returns

`Promise`\<[`ToolTextResult`](../../../shared/types/type-aliases/ToolTextResult.md) \| \{ `client`: [`LspClient`](../../lspClient/classes/LspClient.md); `uri`: `string`; \}\>
