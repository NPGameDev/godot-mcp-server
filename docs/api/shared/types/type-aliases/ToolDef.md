[**@npgamedev/godot-mcp-server**](../../../README.md)

***

[@npgamedev/godot-mcp-server](../../../README.md) / [shared/types](../README.md) / ToolDef

# Type Alias: ToolDef

> **ToolDef** = `object`

Defined in: [src/shared/types.ts:158](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L158)

One built-in tool's static definition — the catalogue entry the registration
layer turns into a live MCP tool. The catalogue is the SSOT; every field here
is consumed at registration time.

## Properties

### annotations?

> `optional` **annotations?**: [`ToolAnnotations`](ToolAnnotations.md)

Defined in: [src/shared/types.ts:163](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L163)

***

### description

> **description**: `string`

Defined in: [src/shared/types.ts:161](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L161)

***

### godotMaxVersion?

> `optional` **godotMaxVersion?**: `string`

Defined in: [src/shared/types.ts:167](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L167)

Maximum Godot version supported ("major.minor", e.g. "4.6"). Omit for no upper bound.

***

### godotMinVersion?

> `optional` **godotMinVersion?**: `string`

Defined in: [src/shared/types.ts:165](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L165)

Minimum Godot version required ("major.minor", e.g. "4.5"). Omit for 4.2+ (baseline).

***

### inputSchema

> **inputSchema**: `ZodRawShape`

Defined in: [src/shared/types.ts:162](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L162)

***

### method

> **method**: `string`

Defined in: [src/shared/types.ts:160](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L160)

***

### name

> **name**: `string`

Defined in: [src/shared/types.ts:159](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L159)

***

### operationParam?

> `optional` **operationParam?**: `string`

Defined in: [src/shared/types.ts:177](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L177)

Names the tool's operation-discriminator enum param — the top-level inputSchema
 key whose values are the distinct operations this tool performs (e.g. "action",
 "operation"). Drives the human-facing operation count; not surfaced to the model.

***

### operations?

> `optional` **operations?**: readonly `string`[]

Defined in: [src/shared/types.ts:181](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L181)

Explicit operation list for a tool whose discriminator is not a plain top-level
 z.enum (e.g. an enum nested inside a union/array). Used in place of operationParam
 when the count can't be read from a top-level enum.

***

### pathParams?

> `optional` **pathParams?**: readonly [`PathGuard`](PathGuard.md)[]

Defined in: [src/shared/types.ts:173](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L173)

Filesystem-path params to syntactically pre-filter before dispatch (strict
 subset of the toolkit guard). Omit for tools with no fs path, or for params
 the toolkit doesn't guard (absolute-allowed source_path, node-tree paths).

***

### successHint?

> `optional` **successHint?**: `string`

Defined in: [src/shared/types.ts:169](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L169)

Brief guidance appended to successful responses — next steps, related tools, common pitfalls. Omit for terminal actions or self-evident results. Does not overwrite toolkit-provided hints.
