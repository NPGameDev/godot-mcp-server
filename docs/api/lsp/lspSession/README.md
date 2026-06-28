[**@npgamedev/godot-mcp-server**](../../README.md)

***

[@npgamedev/godot-mcp-server](../../README.md) / lsp/lspSession

# lsp/lspSession

LSP session layer — the stateful connection core behind the LSP tools.

Owns the lazy singleton [LspClient](../lspClient/classes/LspClient.md), the verified-verdict status reporter
wired by the status-reporter module, the connect prologue (ensureLsp) with its
code/hint mapping, and the file-read + document-open helpers the tool handlers
build on. The thin LSP tool surface sits over [withLspDoc](functions/withLspDoc.md).

## Functions

- [withLspDoc](functions/withLspDoc.md)
