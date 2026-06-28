[**@npgamedev/godot-mcp-server**](../../../README.md)

***

[@npgamedev/godot-mcp-server](../../../README.md) / [shared/types](../README.md) / ToolDef

# Type Alias: ToolDef

> **ToolDef** = `object`

Defined in: [src/shared/types.ts:131](https://github.com/NPGameDev/godot-mcp-server/blob/da81f25434d6169d7009e157eb7c4765a9c98ca6/src/shared/types.ts#L131)

One built-in tool's static definition — the catalogue entry the registration
layer turns into a live MCP tool. The catalogue is the SSOT; every field here
is consumed at registration time.

## Properties

### annotations?

> `optional` **annotations?**: [`ToolAnnotations`](ToolAnnotations.md)

Defined in: [src/shared/types.ts:136](https://github.com/NPGameDev/godot-mcp-server/blob/da81f25434d6169d7009e157eb7c4765a9c98ca6/src/shared/types.ts#L136)

***

### description

> **description**: `string`

Defined in: [src/shared/types.ts:134](https://github.com/NPGameDev/godot-mcp-server/blob/da81f25434d6169d7009e157eb7c4765a9c98ca6/src/shared/types.ts#L134)

***

### godotMaxVersion?

> `optional` **godotMaxVersion?**: `string`

Defined in: [src/shared/types.ts:140](https://github.com/NPGameDev/godot-mcp-server/blob/da81f25434d6169d7009e157eb7c4765a9c98ca6/src/shared/types.ts#L140)

Maximum Godot version supported ("major.minor", e.g. "4.6"). Omit for no upper bound.

***

### godotMinVersion?

> `optional` **godotMinVersion?**: `string`

Defined in: [src/shared/types.ts:138](https://github.com/NPGameDev/godot-mcp-server/blob/da81f25434d6169d7009e157eb7c4765a9c98ca6/src/shared/types.ts#L138)

Minimum Godot version required ("major.minor", e.g. "4.5"). Omit for 4.2+ (baseline).

***

### inputSchema

> **inputSchema**: `ZodRawShape`

Defined in: [src/shared/types.ts:135](https://github.com/NPGameDev/godot-mcp-server/blob/da81f25434d6169d7009e157eb7c4765a9c98ca6/src/shared/types.ts#L135)

***

### method

> **method**: `string`

Defined in: [src/shared/types.ts:133](https://github.com/NPGameDev/godot-mcp-server/blob/da81f25434d6169d7009e157eb7c4765a9c98ca6/src/shared/types.ts#L133)

***

### name

> **name**: `string`

Defined in: [src/shared/types.ts:132](https://github.com/NPGameDev/godot-mcp-server/blob/da81f25434d6169d7009e157eb7c4765a9c98ca6/src/shared/types.ts#L132)

***

### pathParams?

> `optional` **pathParams?**: readonly [`PathGuard`](PathGuard.md)[]

Defined in: [src/shared/types.ts:146](https://github.com/NPGameDev/godot-mcp-server/blob/da81f25434d6169d7009e157eb7c4765a9c98ca6/src/shared/types.ts#L146)

Filesystem-path params to syntactically pre-filter before dispatch (strict
 subset of the toolkit guard). Omit for tools with no fs path, or for params
 the toolkit doesn't guard (absolute-allowed source_path, node-tree paths).

***

### successHint?

> `optional` **successHint?**: `string`

Defined in: [src/shared/types.ts:142](https://github.com/NPGameDev/godot-mcp-server/blob/da81f25434d6169d7009e157eb7c4765a9c98ca6/src/shared/types.ts#L142)

Brief guidance appended to successful responses — next steps, related tools, common pitfalls. Omit for terminal actions or self-evident results. Does not overwrite toolkit-provided hints.
