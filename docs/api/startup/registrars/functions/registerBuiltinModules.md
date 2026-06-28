[**@npgamedev/godot-mcp-server**](../../../README.md)

***

[@npgamedev/godot-mcp-server](../../../README.md) / [startup/registrars](../README.md) / registerBuiltinModules

# Function: registerBuiltinModules()

> **registerBuiltinModules**(`server`, `bridge`, `moduleAllowed`): `void`

Defined in: [src/startup/registrars.ts:40](https://github.com/NPGameDev/godot-mcp-server/blob/da81f25434d6169d7009e157eb7c4765a9c98ca6/src/startup/registrars.ts#L40)

Register every built-in tool module onto the server (scene, node, script, … sound — 23 modules).

## Parameters

### server

`McpServer`

### bridge

[`Bridge`](../../../shared/types/interfaces/Bridge.md)

### moduleAllowed

`Set`\<`string`\>

## Returns

`void`
