[**@npgamedev/godot-mcp-server**](../../../README.md)

***

[@npgamedev/godot-mcp-server](../../../README.md) / [shared/types](../README.md) / Hook

# Type Alias: Hook

> **Hook** = (`req`, `next`) => `Promise`\<[`ToolTextResult`](ToolTextResult.md)\>

Defined in: [src/shared/types.ts:186](https://github.com/NPGameDev/godot-mcp-server/blob/da81f25434d6169d7009e157eb7c4765a9c98ca6/src/shared/types.ts#L186)

Middleware function that wraps tool dispatch.
Call `next()` to continue the chain; return early to short-circuit.

## Parameters

### req

[`ToolRequest`](ToolRequest.md)

### next

() => `Promise`\<[`ToolTextResult`](ToolTextResult.md)\>

## Returns

`Promise`\<[`ToolTextResult`](ToolTextResult.md)\>
