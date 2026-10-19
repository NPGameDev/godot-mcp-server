[**@npgamedev/godot-mcp-server**](../../../README.md)

***

[@npgamedev/godot-mcp-server](../../../README.md) / [shared/version](../README.md) / MIN\_TOOLKIT\_VERSION

# Variable: MIN\_TOOLKIT\_VERSION

> `const` **MIN\_TOOLKIT\_VERSION**: `"1.0"` = `"1.0"`

Defined in: [src/shared/version.ts:45](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/version.ts#L45)

Minimum toolkit version (major.minor) this server needs. Raise it only when the
server takes a real dependency on a newer toolkit wire contract; that raise is a
MAJOR bump (it drops older siblings). From 1.1.0 the toolkit declares its own floor
and sends it as `min_server`.
