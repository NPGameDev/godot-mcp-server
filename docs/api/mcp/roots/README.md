[**@npgamedev/godot-mcp-server**](../../README.md)

***

[@npgamedev/godot-mcp-server](../../README.md) / mcp/roots

# mcp/roots

MCP Roots support.

In the MCP protocol, roots are primarily a CLIENT capability — the
client declares its workspace roots and the server can
request them. This module exposes the Godot project root as a
resource so it's discoverable, and provides a helper for other
modules to access the resolved project path.

The project path is resolved at startup from:
  1. GODOT_MCP_PROJECT_PATH env var (highest precedence)
  2. Registry lookup matching the editor port
  3. process.cwd() (fallback)

## Functions

- [getProjectRoot](functions/getProjectRoot.md)
- [registerRoots](functions/registerRoots.md)
