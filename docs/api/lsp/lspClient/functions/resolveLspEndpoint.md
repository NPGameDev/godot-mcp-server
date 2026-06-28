[**@npgamedev/godot-mcp-server**](../../../README.md)

***

[@npgamedev/godot-mcp-server](../../../README.md) / [lsp/lspClient](../README.md) / resolveLspEndpoint

# Function: resolveLspEndpoint()

> **resolveLspEndpoint**(`projectPath`): [`LspEndpoint`](../type-aliases/LspEndpoint.md)

Defined in: [src/lsp/lspClient.ts:94](https://github.com/NPGameDev/godot-mcp-server/blob/da81f25434d6169d7009e157eb7c4765a9c98ca6/src/lsp/lspClient.ts#L94)

Resolve a project's LSP endpoint at connect time. Priority:
  1. GODOT_MCP_LSP_PORT (+ GODOT_MCP_LSP_HOST) — explicit override, top
     priority, bypasses the registry (the documented multi-instance lever).
  2. discoverLspEndpoint(projectPath) — registry hit (with conflict guard).
  3. miss → 6005 ONLY if no live editor holds it; else unavailable.
Throws LspResolutionError on a conflict or an ambiguous miss — never a blind
6005 fallback (that is what kept comparable tools returning the wrong project).

## Parameters

### projectPath

`string`

## Returns

[`LspEndpoint`](../type-aliases/LspEndpoint.md)
