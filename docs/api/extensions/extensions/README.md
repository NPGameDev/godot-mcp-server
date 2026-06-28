[**@npgamedev/godot-mcp-server**](../../README.md)

***

[@npgamedev/godot-mcp-server](../../README.md) / extensions/extensions

# extensions/extensions

Extension subsystem — the lifecycle of third-party extension tools.

Owns eager (deadline-wrapped, single-flight) discovery, live reconciliation on
the extensions.changed push, the shared ungrouped registrar, and the always-on
extensions_refresh tool. The ExtensionManager facade is pure composition: it
constructs one shared registrar — which owns the known-extension ledger — then
hands that SAME instance to the discovery service (which owns the single-flight
latch) and the change-application service (which applies the extensions.changed
delta), so the ledger stays one consistency boundary. getReadOnly is injected (a
live read of profiles.isReadOnly) so this module imports no other composition
module and unit-tests with a fake server + fake bridge.

## Interfaces

- [ExtensionManager](interfaces/ExtensionManager.md)

## Functions

- [createExtensionManager](functions/createExtensionManager.md)
