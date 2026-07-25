[**@npgamedev/godot-mcp-server**](../../README.md)

***

[@npgamedev/godot-mcp-server](../../README.md) / [registry](../README.md) / liveLspClaimants

# Function: liveLspClaimants()

> **liveLspClaimants**(`port`): `Promise`\<`object`[]\>

Defined in: [src/registry.ts:154](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/registry.ts#L154)

Every editor still credibly claiming a given LSP port — all of them, not just
the newest.

A claimant counts only when it is **pid-alive AND the WS command port its own
entry advertises does not refuse a connection**. The PID check comes first
because it is free and settles the provably-dead entries; the port probe is what
establishes *identity*, since the projection never prunes cross-project entries and
they all default to the same engine LSP port — so a stale entry whose recorded
PID has been recycled to any unrelated process would otherwise resurrect a
closed editor as a rival claimant. An inconclusive probe leaves the claimant
counted — `registryLiveness.classifyProbeOutcome` carries why that direction is
the safe one. Probes run concurrently, so the added latency is one round trip,
not one per candidate.

## Parameters

### port

`number`

## Returns

`Promise`\<`object`[]\>
