[**@npgamedev/godot-mcp-server**](../../README.md)

***

[@npgamedev/godot-mcp-server](../../README.md) / mcp/roots

# mcp/roots

MCP Roots support.

In the MCP protocol, roots are primarily a CLIENT capability — the
client declares its workspace roots and the server can
request them. This module exposes the Godot project root as a
resource so it's discoverable.

The project path is resolved at startup by `resolveProjectPath`
(`startup/projectPath.ts`) and handed in through init().

## Functions

- [registerRoots](functions/registerRoots.md)
