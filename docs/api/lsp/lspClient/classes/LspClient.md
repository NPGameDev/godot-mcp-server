[**@npgamedev/godot-mcp-server**](../../../README.md)

***

[@npgamedev/godot-mcp-server](../../../README.md) / [lsp/lspClient](../README.md) / LspClient

# Class: LspClient

Defined in: [src/lsp/lspClient.ts:202](https://github.com/NPGameDev/godot-mcp-server/blob/da81f25434d6169d7009e157eb7c4765a9c98ca6/src/lsp/lspClient.ts#L202)

## Constructors

### Constructor

> **new LspClient**(`projectPath`): `LspClient`

Defined in: [src/lsp/lspClient.ts:223](https://github.com/NPGameDev/godot-mcp-server/blob/da81f25434d6169d7009e157eb7c4765a9c98ca6/src/lsp/lspClient.ts#L223)

#### Parameters

##### projectPath

`string`

#### Returns

`LspClient`

## Methods

### close()

> **close**(): `Promise`\<`void`\>

Defined in: [src/lsp/lspClient.ts:401](https://github.com/NPGameDev/godot-mcp-server/blob/da81f25434d6169d7009e157eb7c4765a9c98ca6/src/lsp/lspClient.ts#L401)

Graceful shutdown.

#### Returns

`Promise`\<`void`\>

***

### ensureConnected()

> **ensureConnected**(): `Promise`\<`void`\>

Defined in: [src/lsp/lspClient.ts:236](https://github.com/NPGameDev/godot-mcp-server/blob/da81f25434d6169d7009e157eb7c4765a9c98ca6/src/lsp/lspClient.ts#L236)

Ensure connection is established. Lazy — connects on first call.

#### Returns

`Promise`\<`void`\>

***

### getEndpoint()

> **getEndpoint**(): `object`

Defined in: [src/lsp/lspClient.ts:396](https://github.com/NPGameDev/godot-mcp-server/blob/da81f25434d6169d7009e157eb7c4765a9c98ca6/src/lsp/lspClient.ts#L396)

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

Defined in: [src/lsp/lspClient.ts:390](https://github.com/NPGameDev/godot-mcp-server/blob/da81f25434d6169d7009e157eb7c4765a9c98ca6/src/lsp/lspClient.ts#L390)

Check if the client is currently connected.

#### Returns

`boolean`

***

### openDocument()

> **openDocument**(`uri`, `content`): `Promise`\<`void`\>

Defined in: [src/lsp/lspClient.ts:340](https://github.com/NPGameDev/godot-mcp-server/blob/da81f25434d6169d7009e157eb7c4765a9c98ca6/src/lsp/lspClient.ts#L340)

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

Defined in: [src/lsp/lspClient.ts:333](https://github.com/NPGameDev/godot-mcp-server/blob/da81f25434d6169d7009e157eb7c4765a9c98ca6/src/lsp/lspClient.ts#L333)

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

Defined in: [src/lsp/lspClient.ts:312](https://github.com/NPGameDev/godot-mcp-server/blob/da81f25434d6169d7009e157eb7c4765a9c98ca6/src/lsp/lspClient.ts#L312)

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

Defined in: [src/lsp/lspClient.ts:356](https://github.com/NPGameDev/godot-mcp-server/blob/da81f25434d6169d7009e157eb7c4765a9c98ca6/src/lsp/lspClient.ts#L356)

Wait for diagnostics to arrive for a URI (with timeout).

#### Parameters

##### uri

`string`

##### timeoutMs?

`number` = `5000`

#### Returns

`Promise`\<[`DiagnosticEntry`](../type-aliases/DiagnosticEntry.md)[]\>
