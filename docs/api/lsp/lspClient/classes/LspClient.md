[**@npgamedev/godot-mcp-server**](../../../README.md)

***

[@npgamedev/godot-mcp-server](../../../README.md) / [lsp/lspClient](../README.md) / LspClient

# Class: LspClient

Defined in: [src/lsp/lspClient.ts:221](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/lsp/lspClient.ts#L221)

## Constructors

### Constructor

> **new LspClient**(`projectPath`): `LspClient`

Defined in: [src/lsp/lspClient.ts:242](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/lsp/lspClient.ts#L242)

#### Parameters

##### projectPath

`string`

#### Returns

`LspClient`

## Methods

### close()

> **close**(): `Promise`\<`void`\>

Defined in: [src/lsp/lspClient.ts:426](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/lsp/lspClient.ts#L426)

Graceful shutdown.

#### Returns

`Promise`\<`void`\>

***

### ensureConnected()

> **ensureConnected**(): `Promise`\<`void`\>

Defined in: [src/lsp/lspClient.ts:255](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/lsp/lspClient.ts#L255)

Ensure connection is established. Lazy — connects on first call.

#### Returns

`Promise`\<`void`\>

***

### getEndpoint()

> **getEndpoint**(): `object`

Defined in: [src/lsp/lspClient.ts:421](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/lsp/lspClient.ts#L421)

The host:port resolved for the most recent connect attempt (valid after
 doConnect set it — i.e. when a connect was attempted, success or failure).

#### Returns

`object`

##### host

> **host**: `string`

##### port

> **port**: `number`

***

### isConnected()

> **isConnected**(): `boolean`

Defined in: [src/lsp/lspClient.ts:415](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/lsp/lspClient.ts#L415)

Check if the client is currently connected.

#### Returns

`boolean`

***

### openDocument()

> **openDocument**(`uri`, `content`): `Promise`\<`void`\>

Defined in: [src/lsp/lspClient.ts:359](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/lsp/lspClient.ts#L359)

Open a document in the LSP (or update if already open).

#### Parameters

##### uri

`string`

##### content

`string`

#### Returns

`Promise`\<`void`\>

***

### sendNotification()

> **sendNotification**(`method`, `params?`): `void`

Defined in: [src/lsp/lspClient.ts:352](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/lsp/lspClient.ts#L352)

Send a JSON-RPC notification (no response expected).

#### Parameters

##### method

`string`

##### params?

`unknown`

#### Returns

`void`

***

### sendRequest()

> **sendRequest**(`method`, `params?`): `Promise`\<`unknown`\>

Defined in: [src/lsp/lspClient.ts:331](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/lsp/lspClient.ts#L331)

Send a JSON-RPC request and await the response.

#### Parameters

##### method

`string`

##### params?

`unknown`

#### Returns

`Promise`\<`unknown`\>

***

### waitForDiagnostics()

> **waitForDiagnostics**(`uri`, `timeoutMs?`): `Promise`\<[`DiagnosticEntry`](../type-aliases/DiagnosticEntry.md)[]\>

Defined in: [src/lsp/lspClient.ts:381](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/lsp/lspClient.ts#L381)

Wait for diagnostics to arrive for a URI (with timeout).

#### Parameters

##### uri

`string`

##### timeoutMs?

`number` = `5000`

#### Returns

`Promise`\<[`DiagnosticEntry`](../type-aliases/DiagnosticEntry.md)[]\>
