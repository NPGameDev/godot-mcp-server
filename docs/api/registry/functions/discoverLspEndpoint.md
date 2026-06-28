[**@npgamedev/godot-mcp-server**](../../README.md)

***

[@npgamedev/godot-mcp-server](../../README.md) / [registry](../README.md) / discoverLspEndpoint

# Function: discoverLspEndpoint()

> **discoverLspEndpoint**(`projectPath`): \{ `host`: `string`; `port`: `number`; \} \| \{ `conflict`: `true`; `port`: `number`; \} \| `null`

Defined in: [src/registry.ts:181](https://github.com/NPGameDev/godot-mcp-server/blob/da81f25434d6169d7009e157eb7c4765a9c98ca6/src/registry.ts#L181)

Resolve this project's published LSP endpoint, with conservative ownership.
  { host, port } — we own it: connect (then verify rootUri on 4.5+).
  { conflict, port } — a live peer started at-or-before us holds the port.
  null — no usable entry; the caller applies the miss rule (conditional 6005).

Connect only if strictly the EARLIEST live claimant: the engine gives the port
to whoever listen()s first, and started_at is a safe proxy for starts >~1s
apart. A genuine same-second tie fails BOTH sides — never wrong data.

## Parameters

### projectPath

`string`

## Returns

\{ `host`: `string`; `port`: `number`; \} \| \{ `conflict`: `true`; `port`: `number`; \} \| `null`
