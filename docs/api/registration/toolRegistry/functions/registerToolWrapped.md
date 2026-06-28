[**@npgamedev/godot-mcp-server**](../../../README.md)

***

[@npgamedev/godot-mcp-server](../../../README.md) / [registration/toolRegistry](../README.md) / registerToolWrapped

# Function: registerToolWrapped()

> **registerToolWrapped**(`server`, `bridge`, `name`, `config`, `handler`, `opts?`): `void`

Defined in: [src/registration/toolRegistry.ts:123](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/registration/toolRegistry.ts#L123)

Register one tool through the wrapped, pre-flighted path — the **only**
sanctioned way to install a tool. Wraps the SDK handler with a runtime version
gate, a syntactic path pre-filter, and the hook pipeline, then records the tool
ref for later lookup and in-place description refresh.

## Parameters

### server

`McpServer`

### bridge

[`Bridge`](../../../shared/types/interfaces/Bridge.md)

### name

`string`

the tool's MCP wire name (what the client calls)

### config

`any`

the SDK tool config (description, `inputSchema`, annotations);
  raw JSON-Schema from extensions is converted to Zod, and string coercion is
  added so agents may pass JSON-encoded scalars for array/object/number params

### handler

(`input`, `signal?`) => `Promise`\<[`ToolTextResult`](../../../shared/types/type-aliases/ToolTextResult.md)\>

the dispatch function invoked on a call, after every pre-flight check passes

### opts?

version bounds, an explicit hook pipeline (falls back to the
  global one), and path-guard declarations to pre-filter before the bridge round-trip

#### godotMaxVersion?

`string`

#### godotMinVersion?

`string`

#### hookPipeline?

`HookPipeline`

#### pathParams?

readonly [`PathGuard`](../../../shared/types/type-aliases/PathGuard.md)[]

## Returns

`void`

## Remarks

Version-gated tools are filtered out at registration when the connected Godot
version is known and incompatible, and **skipped** when the version is not yet
known — the startup reconcile re-runs registration once it resolves. A second,
defence-in-depth version check runs per call to catch a reconnect to a different
Godot version.

## Example

```ts
registerToolWrapped(
  server,
  bridge,
  "my_tool",
  { description: "…", inputSchema: { path: z.string() } },
  (input) => handleMyTool(bridge, input),
  { godotMinVersion: "4.5", pathParams: [{ param: "path", guard: "project" }] },
);
```
