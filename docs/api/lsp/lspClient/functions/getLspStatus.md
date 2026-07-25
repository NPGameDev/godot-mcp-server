[**@npgamedev/godot-mcp-server**](../../../README.md)

***

[@npgamedev/godot-mcp-server](../../../README.md) / [lsp/lspClient](../README.md) / getLspStatus

# Function: getLspStatus()

> **getLspStatus**(`projectPath`): `Promise`\<[`LspStatus`](../type-aliases/LspStatus.md)\>

Defined in: [src/lsp/lspClient.ts:175](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/lsp/lspClient.ts#L175)

The authoritative LSP verdict for a project, computed without opening an LSP
connection (resolution + registry ownership only — cross-platform PID liveness
corroborated by a peer's own WS command port). The toolkit can't determine this
itself (no engine API for its own LSP bind status), so the server reports it to
the editor dock via editor.set_lsp_status. "active" = this editor owns the port
(per registry / env override); a later editor or a non-registry holder →
conflict / unavailable.

## Parameters

### projectPath

`string`

## Returns

`Promise`\<[`LspStatus`](../type-aliases/LspStatus.md)\>
