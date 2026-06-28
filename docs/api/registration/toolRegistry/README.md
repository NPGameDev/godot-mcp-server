[**@npgamedev/godot-mcp-server**](../../README.md)

***

[@npgamedev/godot-mcp-server](../../README.md) / registration/toolRegistry

# registration/toolRegistry

Tool registry — the one wrapped, pre-flighted path for installing tools onto
the MCP server. Every built-in and extension tool registers through
[registerToolWrapped](functions/registerToolWrapped.md) (or the bulk [registerTools](functions/registerTools.md)), which layers
version-gating, syntactic path-guarding, hook-pipeline wrapping, LLM string
coercion, and tool-ref tracking around the SDK's raw `server.registerTool`.
Registering with the SDK directly silently drops every one of those guarantees.

## Remarks

Per-call dispatch, error shaping, and JSON-Schema → Zod coercion live in sibling
modules under `registration/` and `shared/`; this module owns only the
registration choke point and its two pre-flight maps (version bounds + path guards).

## Functions

- [batchToolRegistration](functions/batchToolRegistration.md)
- [registerTools](functions/registerTools.md)
- [registerToolWrapped](functions/registerToolWrapped.md)
