[**@npgamedev/godot-mcp-server**](../../../README.md)

***

[@npgamedev/godot-mcp-server](../../../README.md) / [registration/toolRegistry](../README.md) / registerTools

# Function: registerTools()

> **registerTools**(`server`, `bridge`, `tools`, `allowedTools?`, `opts?`): `void`

Defined in: [src/registration/toolRegistry.ts:241](https://github.com/NPGameDev/godot-mcp-server/blob/da81f25434d6169d7009e157eb7c4765a9c98ca6/src/registration/toolRegistry.ts#L241)

Bulk-register an array of [ToolDef](../../../shared/types/type-aliases/ToolDef.md)s, each through
[registerToolWrapped](registerToolWrapped.md). The default handler calls the bridge and
JSON-stringifies the result — the path most built-in tool modules follow.

## Parameters

### server

`McpServer`

### bridge

[`Bridge`](../../../shared/types/interfaces/Bridge.md)

### tools

readonly [`ToolDef`](../../../shared/types/type-aliases/ToolDef.md)[]

the tool definitions to register (catalogue order preserved)

### allowedTools?

`Set`\<`string`\>

when set, an allowlist: a tool absent from the set is
  skipped (the per-module surface filter); omit to register every tool

### opts?

`handlers` supplies per-tool overrides for modules with custom
  response shaping (screenshots, summary-first) — these still get `successHint`
  injection; `hookPipeline` overrides the global pipeline

#### handlers?

`Map`\<`string`, (`input`, `signal?`) => `Promise`\<[`ToolTextResult`](../../../shared/types/type-aliases/ToolTextResult.md)\>\>

#### hookPipeline?

`HookPipeline`

## Returns

`void`

## Remarks

In read-only mode, tools excluded by their annotations are skipped here — the
same gate the live SDK surface enforces.
