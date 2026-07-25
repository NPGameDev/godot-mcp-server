[**@npgamedev/godot-mcp-server**](../../README.md)

***

[@npgamedev/godot-mcp-server](../../README.md) / [registry](../README.md) / RegistryEntry

# Interface: RegistryEntry

Defined in: [src/registry.ts:31](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/registry.ts#L31)

One project's registry record, as written by the toolkit. Snake_case fields
mirror the GDScript schema verbatim — this module reads the file the plugin
owns, so the shapes must match byte-for-byte.

## Properties

### godot\_version?

> `optional` **godot\_version?**: `string`

Defined in: [src/registry.ts:38](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/registry.ts#L38)

***

### lsp\_host?

> `optional` **lsp\_host?**: `string`

Defined in: [src/registry.ts:42](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/registry.ts#L42)

***

### lsp\_port?

> `optional` **lsp\_port?**: `number` \| `null`

Defined in: [src/registry.ts:41](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/registry.ts#L41)

***

### pid

> **pid**: `number`

Defined in: [src/registry.ts:34](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/registry.ts#L34)

***

### port

> **port**: `number`

Defined in: [src/registry.ts:32](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/registry.ts#L32)

***

### runtime\_pid

> **runtime\_pid**: `number` \| `null`

Defined in: [src/registry.ts:37](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/registry.ts#L37)

***

### runtime\_port

> **runtime\_port**: `number` \| `null`

Defined in: [src/registry.ts:36](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/registry.ts#L36)

***

### started\_at

> **started\_at**: `number`

Defined in: [src/registry.ts:35](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/registry.ts#L35)

***

### token\_path

> **token\_path**: `string`

Defined in: [src/registry.ts:33](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/registry.ts#L33)
