[**@npgamedev/godot-mcp-server**](../../../README.md)

***

[@npgamedev/godot-mcp-server](../../../README.md) / [shared/version](../README.md) / compareVersions

# Function: compareVersions()

> **compareVersions**(`local`, `remote`): [`VersionSeverity`](../type-aliases/VersionSeverity.md)

Defined in: [src/shared/version.ts:82](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/version.ts#L82)

Compare two semver version strings.

Returns:
  "ok"      — versions match (all components equal)
  "minor"   — same major, different minor or patch
  "major"   — different major version
  "unknown" — remote is undefined/empty (pre-handshake peer)

## Parameters

### local

`string`

### remote

`string` \| `undefined`

## Returns

[`VersionSeverity`](../type-aliases/VersionSeverity.md)
