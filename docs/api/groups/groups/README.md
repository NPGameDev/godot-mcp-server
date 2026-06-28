[**@npgamedev/godot-mcp-server**](../../README.md)

***

[@npgamedev/godot-mcp-server](../../README.md) / groups/groups

# groups/groups

Lazy-load tool groups — specialized workflows loaded on demand via
`discover_tools` rather than advertised eagerly (28 groups, 75 group tools;
`godot-mcp-server --tools-count` is the live source of truth). This module owns
the `discover_tools` meta-tool: keyword/name matching, group activation and
deactivation, and the response enrichment that surfaces the activated surface.

## Interfaces

- [ExtensionCmd](interfaces/ExtensionCmd.md)

## Variables

- [GROUP\_TOOL\_NAMES](variables/GROUP_TOOL_NAMES.md)
- [GROUPS](variables/GROUPS.md)
- [LSP\_TOOLS](variables/LSP_TOOLS.md)
- [RUNTIME\_TOOLS](variables/RUNTIME_TOOLS.md)

## Functions

- [addExtensionGroup](functions/addExtensionGroup.md)
- [findMatchesSingle](functions/findMatchesSingle.md)
- [hasExtensionGroups](functions/hasExtensionGroups.md)
- [registerGroupSystem](functions/registerGroupSystem.md)
- [removeExtensionCommand](functions/removeExtensionCommand.md)
- [removeExtensionGroup](functions/removeExtensionGroup.md)
- [removeUngroupedExtensionTool](functions/removeUngroupedExtensionTool.md)
- [resetLoadedGroups](functions/resetLoadedGroups.md)

## References

### GroupName

Re-exports [GroupName](../groupTypes/type-aliases/GroupName.md)
