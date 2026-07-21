[**@npgamedev/godot-mcp-server**](../../../README.md)

***

[@npgamedev/godot-mcp-server](../../../README.md) / [shared/types](../README.md) / Hook

# Type Alias: Hook

> **Hook** = (`req`, `next`) => `Promise`\<[`ToolTextResult`](ToolTextResult.md)\>

Defined in: [src/shared/types.ts:208](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L208)

Middleware function that wraps tool dispatch.
Call `next()` to continue the chain; return early to short-circuit.

## Parameters

### req

[`ToolRequest`](ToolRequest.md)

### next

() => `Promise`\<[`ToolTextResult`](ToolTextResult.md)\>

## Returns

`Promise`\<[`ToolTextResult`](ToolTextResult.md)\>
