[**@npgamedev/godot-mcp-server**](../../README.md)

***

[@npgamedev/godot-mcp-server](../../README.md) / [registry](../README.md) / RegistryEntry

# Interface: RegistryEntry

Defined in: [src/registry.ts:24](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/registry.ts#L24)

One project's registry record, as written by the toolkit. Snake_case fields
mirror the GDScript schema verbatim — this module reads the file the plugin
owns, so the shapes must match byte-for-byte.

## Properties

### godot\_version?

> `optional` **godot\_version?**: `string`

Defined in: [src/registry.ts:31](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/registry.ts#L31)

***

### lsp\_host?

> `optional` **lsp\_host?**: `string`

Defined in: [src/registry.ts:35](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/registry.ts#L35)

***

### lsp\_port?

> `optional` **lsp\_port?**: `number` \| `null`

Defined in: [src/registry.ts:34](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/registry.ts#L34)

***

### pid

> **pid**: `number`

Defined in: [src/registry.ts:27](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/registry.ts#L27)

***

### port

> **port**: `number`

Defined in: [src/registry.ts:25](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/registry.ts#L25)

***

### runtime\_pid

> **runtime\_pid**: `number` \| `null`

Defined in: [src/registry.ts:30](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/registry.ts#L30)

***

### runtime\_port

> **runtime\_port**: `number` \| `null`

Defined in: [src/registry.ts:29](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/registry.ts#L29)

***

### started\_at

> **started\_at**: `number`

Defined in: [src/registry.ts:28](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/registry.ts#L28)

***

### token\_path

> **token\_path**: `string`

Defined in: [src/registry.ts:26](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/registry.ts#L26)
