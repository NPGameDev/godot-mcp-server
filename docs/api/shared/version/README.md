[**@npgamedev/godot-mcp-server**](../../README.md)

***

[@npgamedev/godot-mcp-server](../../README.md) / shared/version

# shared/version

Version utilities — the server's own version (read from package.json) and the
Godot version-gating helpers. [GodotVer](type-aliases/GodotVer.md) is the parsed `[major, minor]`
tuple the tool-version gate compares against; the rest parse, compare, and
bound-check engine versions for the registration-time and per-call gates, plus
a semver severity compare and the declared toolkit floor for the auth-handshake
version check.

## Type Aliases

- [FloorVerdict](type-aliases/FloorVerdict.md)
- [GodotVer](type-aliases/GodotVer.md)
- [VersionSeverity](type-aliases/VersionSeverity.md)

## Variables

- [MIN\_TOOLKIT\_VERSION](variables/MIN_TOOLKIT_VERSION.md)

## Functions

- [checkFloor](functions/checkFloor.md)
- [compareGodotVer](functions/compareGodotVer.md)
- [compareVersions](functions/compareVersions.md)
- [getServerVersion](functions/getServerVersion.md)
- [isVersionAtLeast](functions/isVersionAtLeast.md)
- [isVersionAtMost](functions/isVersionAtMost.md)
- [isVersionCompatible](functions/isVersionCompatible.md)
- [parseGodotVer](functions/parseGodotVer.md)
- [parseMajorMinor](functions/parseMajorMinor.md)
