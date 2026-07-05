[**@npgamedev/godot-mcp-server**](../../README.md)

***

[@npgamedev/godot-mcp-server](../../README.md) / transport/bridge

# transport/bridge

Transport bridge — the editor-side WebSocket facade the whole server calls
through. [createBridge](functions/createBridge.md) returns the single [Bridge](../../shared/types/interfaces/Bridge.md) the tool layer
uses to reach the running Godot editor (and, lazily, the playtest runtime): it
drives the auth handshake, the connected-version lifecycle, editor-port
re-discovery on disconnect, and delegation of the runtime channel.

## Remarks

The bridge is the reference implementation of the project's async discipline —
every call it forwards is timeout-bounded and cancellation-aware. Project-hash,
token path, and WS framing are cross-repo contract with the toolkit; changing
them is a contract change (docs/dev/contract.md in the toolkit repo), not a
free refactor.

## Interfaces

- [AuthResponse](interfaces/AuthResponse.md)
- [BridgeOptions](interfaces/BridgeOptions.md)

## Functions

- [createBridge](functions/createBridge.md)

## References

### NotificationHandler

Re-exports [NotificationHandler](../../shared/types/type-aliases/NotificationHandler.md)
