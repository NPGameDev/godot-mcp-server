[**@npgamedev/godot-mcp-server**](../../../README.md)

***

[@npgamedev/godot-mcp-server](../../../README.md) / [lsp/lspClient](../README.md) / resolveLspEndpoint

# Function: resolveLspEndpoint()

> **resolveLspEndpoint**(`projectPath`): `Promise`\<[`LspEndpoint`](../type-aliases/LspEndpoint.md)\>

Defined in: [src/lsp/lspClient.ts:118](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/lsp/lspClient.ts#L118)

Resolve a project's LSP endpoint at connect time. Priority:
  1. --lsp-port / GODOT_MCP_LSP_PORT (+ --lsp-host / GODOT_MCP_LSP_HOST) —
     explicit override (CLI wins over env), top priority, bypasses the registry
     (the documented multi-instance lever).
  2. discoverLspEndpoint(projectPath) — registry hit (with conflict guard).
  3. miss → 6005 ONLY if no live editor holds it; else unavailable.
Throws LspResolutionError on a conflict or an ambiguous miss — never a blind
6005 fallback (that is what kept comparable tools returning the wrong project).
An invalid override value is skipped LOUDLY (stderr warning, fall through to
discovery): the env var is re-read live on every connect, so a config reload
can rewrite it mid-session after the startup validation gate has passed.

## Parameters

### projectPath

`string`

## Returns

`Promise`\<[`LspEndpoint`](../type-aliases/LspEndpoint.md)\>
