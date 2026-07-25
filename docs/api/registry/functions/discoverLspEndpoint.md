[**@npgamedev/godot-mcp-server**](../../README.md)

***

[@npgamedev/godot-mcp-server](../../README.md) / [registry](../README.md) / discoverLspEndpoint

# Function: discoverLspEndpoint()

> **discoverLspEndpoint**(`projectPath`): `Promise`\<\{ `host`: `string`; `port`: `number`; \} \| \{ `conflict`: `true`; `port`: `number`; \} \| `null`\>

Defined in: [src/registry.ts:176](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/registry.ts#L176)

Resolve this project's published LSP endpoint, with conservative ownership.
  { host, port } — we own it: connect (then verify rootUri on 4.5+).
  { conflict, port } — a corroborated peer started at-or-before us holds the port.
  null — no usable entry; the caller applies the miss rule (conditional 6005).

Connect only if strictly the EARLIEST corroborated claimant: the engine gives
the port to whoever listen()s first, and started_at is a safe proxy for starts
>~1s apart. A genuine same-second tie fails BOTH sides — never wrong data.

## Parameters

### projectPath

`string`

## Returns

`Promise`\<\{ `host`: `string`; `port`: `number`; \} \| \{ `conflict`: `true`; `port`: `number`; \} \| `null`\>
