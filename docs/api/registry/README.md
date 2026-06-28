[**@npgamedev/godot-mcp-server**](../README.md)

***

[@npgamedev/godot-mcp-server](../README.md) / registry

# registry

System-wide project registry reader.

Mirrors the GDScript `registry_client.gd` — same file, same schema, same path
normalisation. The plugin writes; this module reads. Resolves a project's
editor / runtime / LSP endpoints by absolute path, and optionally watches the
registry file so runtime-port changes push to the bridge without per-RPC I/O.

## Interfaces

- [RegistryEntry](interfaces/RegistryEntry.md)

## Functions

- [discoverLspEndpoint](functions/discoverLspEndpoint.md)
- [discoverRuntime](functions/discoverRuntime.md)
- [getCachedRuntimePort](functions/getCachedRuntimePort.md)
- [isWatcherActive](functions/isWatcherActive.md)
- [liveLspClaimants](functions/liveLspClaimants.md)
- [lookupProject](functions/lookupProject.md)
- [normalizePath](functions/normalizePath.md)
- [registryPath](functions/registryPath.md)
- [unwatchRegistry](functions/unwatchRegistry.md)
- [watchRegistry](functions/watchRegistry.md)
