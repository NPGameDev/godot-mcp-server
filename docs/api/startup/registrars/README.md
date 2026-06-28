[**@npgamedev/godot-mcp-server**](../../README.md)

***

[@npgamedev/godot-mcp-server](../../README.md) / startup/registrars

# startup/registrars

Built-in tool-surface registration — the single place every built-in
`<module>.register(...)` call is enumerated, plus the `discover_tools` group
system. Pure delegation, no state: the composition root and the config-reload
path both call through here, supplying the server, bridge, and the live
registration inputs (module allowlist / read-only flag).

## Functions

- [registerBuiltinModules](functions/registerBuiltinModules.md)
- [registerGroups](functions/registerGroups.md)
