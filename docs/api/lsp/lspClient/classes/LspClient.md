[**@npgamedev/godot-mcp-server**](../../../README.md)

***

[@npgamedev/godot-mcp-server](../../../README.md) / [lsp/lspClient](../README.md) / LspClient

# Class: LspClient

Defined in: [src/lsp/lspClient.ts:231](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/lsp/lspClient.ts#L231)

## Constructors

### Constructor

> **new LspClient**(`projectPath`, `opts?`): `LspClient`

Defined in: [src/lsp/lspClient.ts:261](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/lsp/lspClient.ts#L261)

#### Parameters

##### projectPath

`string`

##### opts?

###### initializeTimeoutMs?

`number`

#### Returns

`LspClient`

## Methods

### close()

> **close**(): `Promise`\<`void`\>

Defined in: [src/lsp/lspClient.ts:489](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/lsp/lspClient.ts#L489)

Graceful shutdown.

#### Returns

`Promise`\<`void`\>

***

### closeDocument()

> **closeDocument**(`uri`): `Promise`\<`void`\>

Defined in: [src/lsp/lspClient.ts:419](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/lsp/lspClient.ts#L419)

Close a document in the LSP, clearing its open + diagnostics state.

 Keeps client and server open-state in lockstep — the 4.7 GDScript LSP
 erases per-peer parser state on didClose and ERR_FAILs a re-didOpen of a
 file it still thinks is open, so a batch that reopens files must close
 each first. Call only AFTER collecting a URI's diagnostics — never while a
 waitForDiagnostics for it is still pending.

#### Parameters

##### uri

`string`

#### Returns

`Promise`\<`void`\>

***

### ensureConnected()

> **ensureConnected**(): `Promise`\<`void`\>

Defined in: [src/lsp/lspClient.ts:275](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/lsp/lspClient.ts#L275)

Ensure connection is established. Lazy — connects on first call.

#### Returns

`Promise`\<`void`\>

***

### getEndpoint()

> **getEndpoint**(): `object`

Defined in: [src/lsp/lspClient.ts:484](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/lsp/lspClient.ts#L484)

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

Defined in: [src/lsp/lspClient.ts:472](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/lsp/lspClient.ts#L472)

Check if the client is currently connected.

#### Returns

`boolean`

***

### openDocument()

> **openDocument**(`uri`, `content`): `Promise`\<`void`\>

Defined in: [src/lsp/lspClient.ts:385](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/lsp/lspClient.ts#L385)

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

Defined in: [src/lsp/lspClient.ts:378](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/lsp/lspClient.ts#L378)

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

> **sendRequest**(`method`, `params?`, `timeoutMs?`): `Promise`\<`unknown`\>

Defined in: [src/lsp/lspClient.ts:357](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/lsp/lspClient.ts#L357)

Send a JSON-RPC request and await the response.
 `timeoutMs` overrides REQUEST\_TIMEOUT\_MS for this request only
 (used for the patient first `initialize`); omitted = default.

#### Parameters

##### method

`string`

##### params?

`unknown`

##### timeoutMs?

`number`

#### Returns

`Promise`\<`unknown`\>

***

### waitForDiagnostics()

> **waitForDiagnostics**(`uri`, `timeoutMs?`): `Promise`\<[`DiagnosticEntry`](../type-aliases/DiagnosticEntry.md)[] \| `undefined`\>

Defined in: [src/lsp/lspClient.ts:435](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/lsp/lspClient.ts#L435)

Wait for a diagnostics notification for a URI (with timeout).

 Tri-state: a received notification returns its [DiagnosticEntry](../type-aliases/DiagnosticEntry.md)
 array — which may be `[]` for a clean file (a clean file DOES publish an
 empty-diagnostics notification on every supported Godot version). A
 timeout with no notification returns `undefined` — status unknown, which
 the caller must NOT conflate with clean. The distinction is load-bearing
 for the project scan: a timed-out file is never counted clean.

#### Parameters

##### uri

`string`

##### timeoutMs?

`number` = `5000`

#### Returns

`Promise`\<[`DiagnosticEntry`](../type-aliases/DiagnosticEntry.md)[] \| `undefined`\>
