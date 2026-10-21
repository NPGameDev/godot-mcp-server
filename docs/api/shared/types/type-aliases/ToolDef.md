[**@npgamedev/godot-mcp-server**](../../../README.md)

***

[@npgamedev/godot-mcp-server](../../../README.md) / [shared/types](../README.md) / ToolDef

# Type Alias: ToolDef

> **ToolDef** = `object`

Defined in: [src/shared/types.ts:170](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L170)

One built-in tool's static definition — the catalogue entry the registration
layer turns into a live MCP tool. The catalogue is the SSOT; every field here
is consumed at registration time.

## Properties

### annotations?

> `optional` **annotations?**: [`ToolAnnotations`](ToolAnnotations.md)

Defined in: [src/shared/types.ts:181](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L181)

***

### describe?

> `optional` **describe?**: (`version`) => `string`

Defined in: [src/shared/types.ts:179](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L179)

Renders the description for the connected Godot version (`null` while it is not yet
 known). Tool registration, eager and group, calls it in place of reading `description`.
 Catalogue listings (the docs generator, the tool counts, `discover_tools`) keep the
 static `description`, the version-neutral text that is true on every version, so
 `describe(null)` must equal `description`.

#### Parameters

##### version

[`GodotVer`](../../version/type-aliases/GodotVer.md) \| `null`

#### Returns

`string`

***

### description

> **description**: `string`

Defined in: [src/shared/types.ts:173](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L173)

***

### godotMaxVersion?

> `optional` **godotMaxVersion?**: `string`

Defined in: [src/shared/types.ts:185](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L185)

Maximum Godot version supported ("major.minor", e.g. "4.6"). Omit for no upper bound.

***

### godotMinVersion?

> `optional` **godotMinVersion?**: `string`

Defined in: [src/shared/types.ts:183](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L183)

Minimum Godot version required ("major.minor", e.g. "4.5"). Omit for 4.2+ (baseline).

***

### inputSchema

> **inputSchema**: `ZodRawShape`

Defined in: [src/shared/types.ts:180](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L180)

***

### method

> **method**: `string`

Defined in: [src/shared/types.ts:172](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L172)

***

### name

> **name**: `string`

Defined in: [src/shared/types.ts:171](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L171)

***

### operationHints?

> `optional` **operationHints?**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [src/shared/types.ts:191](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L191)

Per-operation success hints, keyed by the value of the `operationParam` argument. A call whose
 operation has an entry gets that hint in place of successHint; any other call gets successHint.
 Use it when one hint would mislead for some of the tool's operations.

***

### operationParam?

> `optional` **operationParam?**: `string`

Defined in: [src/shared/types.ts:199](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L199)

Names the tool's operation-discriminator enum param — the top-level inputSchema
 key whose values are the distinct operations this tool performs (e.g. "action",
 "operation"). Drives the human-facing operation count; not surfaced to the model.

***

### operations?

> `optional` **operations?**: readonly `string`[]

Defined in: [src/shared/types.ts:203](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L203)

Explicit operation list for a tool whose discriminator is not a plain top-level
 z.enum (e.g. an enum nested inside a union/array). Used in place of operationParam
 when the count can't be read from a top-level enum.

***

### pathParams?

> `optional` **pathParams?**: readonly [`PathGuard`](PathGuard.md)[]

Defined in: [src/shared/types.ts:195](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L195)

Filesystem-path params to syntactically pre-filter before dispatch (strict
 subset of the toolkit guard). Omit for tools with no fs path, or for params
 the toolkit doesn't guard (absolute-allowed source_path, node-tree paths).

***

### successHint?

> `optional` **successHint?**: `string`

Defined in: [src/shared/types.ts:187](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L187)

Brief guidance appended to successful responses — next steps, related tools, common pitfalls. Omit for terminal actions or self-evident results. Does not overwrite toolkit-provided hints.
