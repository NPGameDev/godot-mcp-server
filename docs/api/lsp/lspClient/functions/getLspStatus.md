[**@npgamedev/godot-mcp-server**](../../../README.md)

***

[@npgamedev/godot-mcp-server](../../../README.md) / [lsp/lspClient](../README.md) / getLspStatus

# Function: getLspStatus()

> **getLspStatus**(`projectPath`): [`LspStatus`](../type-aliases/LspStatus.md)

Defined in: [src/lsp/lspClient.ts:146](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/lsp/lspClient.ts#L146)

The authoritative LSP verdict for a project, computed without opening a
connection (resolution + registry ownership only — reliable cross-platform
liveness via process.kill). The toolkit can't determine this itself (no engine
API for its own LSP bind status), so the server reports it to the editor dock
via editor.set_lsp_status. "active" = this editor owns the port (per registry /
env override); a later editor or a non-registry holder → conflict / unavailable.

## Parameters

### projectPath

`string`

## Returns

[`LspStatus`](../type-aliases/LspStatus.md)
