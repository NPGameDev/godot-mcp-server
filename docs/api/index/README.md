[**@npgamedev/godot-mcp-server**](../README.md)

***

[@npgamedev/godot-mcp-server](../README.md) / index

# index

Composition root + CLI entry (the npm `bin`). Constructs and wires the whole
server in dependency order — bridge, MCP server, hook pipeline, the built-in
tool surface, groups, prompts/resources/roots, the extension manager, and the
config/version reconciler — then connects the stdio transport LAST so nothing is
advertised before its guards are in place.

## Remarks

Owns sequencing and wiring only — no domain logic (that lives in the modules it
composes). The ordering is load-bearing: preflight may `process.exit` (Node
version check, `--help` / a CLI parse error / `--tools-count` / `--list-eager`); the transport
connects only after the full tool surface and the notification router are ready.
