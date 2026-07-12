[**@npgamedev/godot-mcp-server**](../../../README.md)

***

[@npgamedev/godot-mcp-server](../../../README.md) / [shared/types](../README.md) / ToolDef

# Type Alias: ToolDef

> **ToolDef** = `object`

Defined in: [src/shared/types.ts:145](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L145)

One built-in tool's static definition — the catalogue entry the registration
layer turns into a live MCP tool. The catalogue is the SSOT; every field here
is consumed at registration time.

## Properties

### annotations?

> `optional` **annotations?**: [`ToolAnnotations`](ToolAnnotations.md)

Defined in: [src/shared/types.ts:150](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L150)

***

### description

> **description**: `string`

Defined in: [src/shared/types.ts:148](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L148)

***

### godotMaxVersion?

> `optional` **godotMaxVersion?**: `string`

Defined in: [src/shared/types.ts:154](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L154)

Maximum Godot version supported ("major.minor", e.g. "4.6"). Omit for no upper bound.

***

### godotMinVersion?

> `optional` **godotMinVersion?**: `string`

Defined in: [src/shared/types.ts:152](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L152)

Minimum Godot version required ("major.minor", e.g. "4.5"). Omit for 4.2+ (baseline).

***

### inputSchema

> **inputSchema**: `ZodRawShape`

Defined in: [src/shared/types.ts:149](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L149)

***

### method

> **method**: `string`

Defined in: [src/shared/types.ts:147](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L147)

***

### name

> **name**: `string`

Defined in: [src/shared/types.ts:146](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L146)

***

### pathParams?

> `optional` **pathParams?**: readonly [`PathGuard`](PathGuard.md)[]

Defined in: [src/shared/types.ts:160](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L160)

Filesystem-path params to syntactically pre-filter before dispatch (strict
 subset of the toolkit guard). Omit for tools with no fs path, or for params
 the toolkit doesn't guard (absolute-allowed source_path, node-tree paths).

***

### successHint?

> `optional` **successHint?**: `string`

Defined in: [src/shared/types.ts:156](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L156)

Brief guidance appended to successful responses — next steps, related tools, common pitfalls. Omit for terminal actions or self-evident results. Does not overwrite toolkit-provided hints.
