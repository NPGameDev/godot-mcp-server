[**@npgamedev/godot-mcp-server**](../../../README.md)

***

[@npgamedev/godot-mcp-server](../../../README.md) / [shared/types](../README.md) / ExtensionCmdWire

# Type Alias: ExtensionCmdWire

> **ExtensionCmdWire** = `object`

Defined in: [src/shared/types.ts:198](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L198)

One extension command as it arrives over the wire from the toolkit plugin —
the payload of extensions.refresh/list results (ExtResult.commands[]) and the
extensions.changed push notification. Snake_case fields mirror the GDScript
registry; the server maps them to camelCase MCP tool config at registration.

## Properties

### annotations?

> `optional` **annotations?**: `Record`\<`string`, `boolean`\>

Defined in: [src/shared/types.ts:202](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L202)

***

### description?

> `optional` **description?**: `string`

Defined in: [src/shared/types.ts:200](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L200)

***

### group?

> `optional` **group?**: `object`

Defined in: [src/shared/types.ts:203](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L203)

#### description?

> `optional` **description?**: `string`

#### keywords?

> `optional` **keywords?**: `string`[]

#### name

> **name**: `string`

***

### input\_schema?

> `optional` **input\_schema?**: `Record`\<`string`, `unknown`\>

Defined in: [src/shared/types.ts:201](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L201)

***

### max\_godot\_version?

> `optional` **max\_godot\_version?**: `string`

Defined in: [src/shared/types.ts:206](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L206)

***

### method

> **method**: `string`

Defined in: [src/shared/types.ts:199](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L199)

***

### min\_godot\_version?

> `optional` **min\_godot\_version?**: `string`

Defined in: [src/shared/types.ts:205](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L205)

***

### timeout\_ms?

> `optional` **timeout\_ms?**: `number`

Defined in: [src/shared/types.ts:204](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L204)
