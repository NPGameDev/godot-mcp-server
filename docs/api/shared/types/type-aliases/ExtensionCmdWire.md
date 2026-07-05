[**@npgamedev/godot-mcp-server**](../../../README.md)

***

[@npgamedev/godot-mcp-server](../../../README.md) / [shared/types](../README.md) / ExtensionCmdWire

# Type Alias: ExtensionCmdWire

> **ExtensionCmdWire** = `object`

Defined in: [src/shared/types.ts:174](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L174)

One extension command as it arrives over the wire from the toolkit plugin —
the payload of extensions.refresh/list results (ExtResult.commands[]) and the
extensions.changed push notification. Snake_case fields mirror the GDScript
registry; the server maps them to camelCase MCP tool config at registration.

## Properties

### annotations?

> `optional` **annotations?**: `Record`\<`string`, `boolean`\>

Defined in: [src/shared/types.ts:178](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L178)

***

### description?

> `optional` **description?**: `string`

Defined in: [src/shared/types.ts:176](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L176)

***

### group?

> `optional` **group?**: `object`

Defined in: [src/shared/types.ts:179](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L179)

#### description?

> `optional` **description?**: `string`

#### keywords?

> `optional` **keywords?**: `string`[]

#### name

> **name**: `string`

***

### input\_schema?

> `optional` **input\_schema?**: `Record`\<`string`, `unknown`\>

Defined in: [src/shared/types.ts:177](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L177)

***

### max\_godot\_version?

> `optional` **max\_godot\_version?**: `string`

Defined in: [src/shared/types.ts:182](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L182)

***

### method

> **method**: `string`

Defined in: [src/shared/types.ts:175](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L175)

***

### min\_godot\_version?

> `optional` **min\_godot\_version?**: `string`

Defined in: [src/shared/types.ts:181](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L181)

***

### timeout\_ms?

> `optional` **timeout\_ms?**: `number`

Defined in: [src/shared/types.ts:180](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/types.ts#L180)
