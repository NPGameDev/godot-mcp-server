[**@npgamedev/godot-mcp-server**](../../../README.md)

***

[@npgamedev/godot-mcp-server](../../../README.md) / [shared/version](../README.md) / parseMajorMinor

# Function: parseMajorMinor()

> **parseMajorMinor**(`v`): \[`number`, `number`\] \| `undefined`

Defined in: [src/shared/version.ts:57](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/version.ts#L57)

Parse a strict `major.minor` or `major.minor.patch` version, with an optional
pre-release or build tag, to `[major, minor]`.

## Parameters

### v

`unknown`

## Returns

\[`number`, `number`\] \| `undefined`

`undefined` for anything else: missing, empty, non-numeric, a bare major
  (`"1"`) or more than three numeric parts.
