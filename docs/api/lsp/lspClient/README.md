[**@npgamedev/godot-mcp-server**](../../README.md)

***

[@npgamedev/godot-mcp-server](../../README.md) / lsp/lspClient

# lsp/lspClient

Lightweight LSP client for Godot's built-in GDScript language server.
The endpoint is discovered PER PROJECT from the registry at connect time
(GODOT_MCP_LSP_PORT/_HOST override it); a collision fails visibly rather than
silently reaching the wrong editor. See ADR 0008 (toolkit). Lazy connection —
the first request triggers connect + the initialize handshake.

## Classes

- [LspClient](classes/LspClient.md)
- [LspResolutionError](classes/LspResolutionError.md)

## Type Aliases

- [DiagnosticEntry](type-aliases/DiagnosticEntry.md)
- [LspEndpoint](type-aliases/LspEndpoint.md)
- [LspStatus](type-aliases/LspStatus.md)

## Functions

- [getLspStatus](functions/getLspStatus.md)
- [resolveLspEndpoint](functions/resolveLspEndpoint.md)
