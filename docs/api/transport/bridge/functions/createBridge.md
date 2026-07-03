[**@npgamedev/godot-mcp-server**](../../../README.md)

***

[@npgamedev/godot-mcp-server](../../../README.md) / [transport/bridge](../README.md) / createBridge

# Function: createBridge()

> **createBridge**(`editorUrl`, `opts?`): [`Bridge`](../../../shared/types/interfaces/Bridge.md) & `object`

Defined in: [src/transport/bridge.ts:66](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/transport/bridge.ts#L66)

Build the bridge for one Godot project. Connection is lazy — the first
[Bridge.call](../../../shared/types/interfaces/Bridge.md#call) performs the WebSocket connect + auth handshake; the runtime
channel connects on demand when a playtest is discovered.

## Parameters

### editorUrl

`string`

the editor WebSocket URL (`ws://127.0.0.1:<port>`); the port
  is re-discovered from the registry on disconnect unless `explicitEditorPort` is
  set or the project path is unknown

### opts?

[`BridgeOptions`](../interfaces/BridgeOptions.md)

see [BridgeOptions](../interfaces/BridgeOptions.md): project path for registry discovery,
  static-port overrides, and the response/buffer caps pushed to the plugin after auth

## Returns

the [Bridge](../../../shared/types/interfaces/Bridge.md), augmented with `onNotification` (unsolicited plugin
  pushes) and `onGodotVersionKnown` (fires once on the unknown → known version
  transition, so the composition root can complete a tool surface registered
  before the editor reported its version)
