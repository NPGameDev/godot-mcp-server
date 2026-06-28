[**@npgamedev/godot-mcp-server**](../../../README.md)

***

[@npgamedev/godot-mcp-server](../../../README.md) / [shared/types](../README.md) / ExtensionCmdWire

# Type Alias: ExtensionCmdWire

> **ExtensionCmdWire** = `object`

Defined in: [src/shared/types.ts:163](https://github.com/NPGameDev/godot-mcp-server/blob/da81f25434d6169d7009e157eb7c4765a9c98ca6/src/shared/types.ts#L163)

One extension command as it arrives over the wire from the toolkit plugin —
the payload of extensions.refresh/list results (ExtResult.commands[]) and the
extensions.changed push notification. Snake_case fields mirror the GDScript
registry; the server maps them to camelCase MCP tool config at registration.

## Properties

### annotations?

> `optional` **annotations?**: `Record`\<`string`, `boolean`\>

Defined in: [src/shared/types.ts:167](https://github.com/NPGameDev/godot-mcp-server/blob/da81f25434d6169d7009e157eb7c4765a9c98ca6/src/shared/types.ts#L167)

***

### description?

> `optional` **description?**: `string`

Defined in: [src/shared/types.ts:165](https://github.com/NPGameDev/godot-mcp-server/blob/da81f25434d6169d7009e157eb7c4765a9c98ca6/src/shared/types.ts#L165)

***

### group?

> `optional` **group?**: `object`

Defined in: [src/shared/types.ts:168](https://github.com/NPGameDev/godot-mcp-server/blob/da81f25434d6169d7009e157eb7c4765a9c98ca6/src/shared/types.ts#L168)

#### description?

> `optional` **description?**: `string`

#### keywords?

> `optional` **keywords?**: `string`[]

#### name

> **name**: `string`

***

### input\_schema?

> `optional` **input\_schema?**: `Record`\<`string`, `unknown`\>

Defined in: [src/shared/types.ts:166](https://github.com/NPGameDev/godot-mcp-server/blob/da81f25434d6169d7009e157eb7c4765a9c98ca6/src/shared/types.ts#L166)

***

### max\_godot\_version?

> `optional` **max\_godot\_version?**: `string`

Defined in: [src/shared/types.ts:171](https://github.com/NPGameDev/godot-mcp-server/blob/da81f25434d6169d7009e157eb7c4765a9c98ca6/src/shared/types.ts#L171)

***

### method

> **method**: `string`

Defined in: [src/shared/types.ts:164](https://github.com/NPGameDev/godot-mcp-server/blob/da81f25434d6169d7009e157eb7c4765a9c98ca6/src/shared/types.ts#L164)

***

### min\_godot\_version?

> `optional` **min\_godot\_version?**: `string`

Defined in: [src/shared/types.ts:170](https://github.com/NPGameDev/godot-mcp-server/blob/da81f25434d6169d7009e157eb7c4765a9c98ca6/src/shared/types.ts#L170)

***

### timeout\_ms?

> `optional` **timeout\_ms?**: `number`

Defined in: [src/shared/types.ts:169](https://github.com/NPGameDev/godot-mcp-server/blob/da81f25434d6169d7009e157eb7c4765a9c98ca6/src/shared/types.ts#L169)
