[**@npgamedev/godot-mcp-server**](../../../README.md)

***

[@npgamedev/godot-mcp-server](../../../README.md) / [shared/types](../README.md) / ExtensionCmdWire

# Type Alias: ExtensionCmdWire

> **ExtensionCmdWire** = `object`

Defined in: [src/shared/types.ts:223](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L223)

One extension command as it arrives over the wire from the toolkit plugin —
the payload of extensions.refresh/list results (ExtResult.commands[]) and the
extensions.changed push notification. Snake_case fields mirror the GDScript
registry; the server maps them to camelCase MCP tool config at registration.

## Properties

### annotations?

> `optional` **annotations?**: `Record`\<`string`, `boolean`\>

Defined in: [src/shared/types.ts:227](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L227)

***

### description?

> `optional` **description?**: `string`

Defined in: [src/shared/types.ts:225](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L225)

***

### group?

> `optional` **group?**: `object`

Defined in: [src/shared/types.ts:228](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L228)

#### description?

> `optional` **description?**: `string`

#### keywords?

> `optional` **keywords?**: `string`[]

#### name

> **name**: `string`

***

### input\_schema?

> `optional` **input\_schema?**: `Record`\<`string`, `unknown`\>

Defined in: [src/shared/types.ts:226](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L226)

***

### method

> **method**: `string`

Defined in: [src/shared/types.ts:224](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L224)

***

### timeout\_ms?

> `optional` **timeout\_ms?**: `number`

Defined in: [src/shared/types.ts:229](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L229)
