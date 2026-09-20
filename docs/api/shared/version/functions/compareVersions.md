[**@npgamedev/godot-mcp-server**](../../../README.md)

***

[@npgamedev/godot-mcp-server](../../../README.md) / [shared/version](../README.md) / compareVersions

# Function: compareVersions()

> **compareVersions**(`local`, `remote`): [`VersionSeverity`](../type-aliases/VersionSeverity.md)

Defined in: [src/shared/version.ts:88](https://github.com/NPGameDev/godot-mcp-server/blob/main/src/shared/version.ts#L88)

Compare two semver version strings.

Returns:
  "ok"      — versions match (all components equal)
  "patch"   — same major+minor, different patch
  "minor"   — same major, different minor
  "major"   — different major version
  "unknown" — remote is undefined/empty (pre-handshake peer)

A patch difference is its own severity because compatibility floors are declared
at major.minor (ADR 0024) — the patch segment carries no compatibility meaning, so
a patch-level difference between the two halves is not something to warn about.

## Parameters

### local

`string`

### remote

`string` \| `undefined`

## Returns

[`VersionSeverity`](../type-aliases/VersionSeverity.md)
