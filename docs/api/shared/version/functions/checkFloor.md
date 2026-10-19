[**@npgamedev/godot-mcp-server**](../../../README.md)

***

[@npgamedev/godot-mcp-server](../../../README.md) / [shared/version](../README.md) / checkFloor

# Function: checkFloor()

> **checkFloor**(`peerVersion`, `floorMajorMinor`): [`FloorVerdict`](../type-aliases/FloorVerdict.md)

Defined in: [src/shared/version.ts:72](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/version.ts#L72)

Judge a peer version against a declared `major.minor` floor; the patch segment is
ignored. Pure and advisory: it never refuses, callers only print.

## Parameters

### peerVersion

`unknown`

### floorMajorMinor

`string`

## Returns

[`FloorVerdict`](../type-aliases/FloorVerdict.md)

`"unknown"` when either side is unparsable, so the caller falls through to
  its product-version lines.
