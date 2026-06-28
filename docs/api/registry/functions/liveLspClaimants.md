[**@npgamedev/godot-mcp-server**](../../README.md)

***

[@npgamedev/godot-mcp-server](../../README.md) / [registry](../README.md) / liveLspClaimants

# Function: liveLspClaimants()

> **liveLspClaimants**(`port`): `object`[]

Defined in: [src/registry.ts:160](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/registry.ts#L160)

Every LIVE editor claiming a given LSP port. Matches entry.lsp_port and
returns all claimants (not just the newest). Dead PIDs are filtered via
process.kill(pid, 0) — reliable on Windows, unlike the toolkit's
OS.is_process_running.

## Parameters

### port

`number`

## Returns

`object`[]
