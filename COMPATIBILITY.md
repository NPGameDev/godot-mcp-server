# Compatibility Notes

## Extension System

### Live Reload

- **GDScript extensions:** Detected immediately on filesystem change (~500ms
  debounce). No restart or reconnect required.
- **C# extensions:** Require `dotnet build` for `get_global_class_list()` to
  reflect additions/removals. Matches Godot's own C# hot-reload behavior.

### Notification Behavior

- Extension changes produce exactly 1 `notifications/tools/list_changed` event
  per change batch, regardless of how many tools were added or removed.
- No notification fires for no-op changes (unrelated file saves, duplicate
  scans).

### Client-Side Limitations

- Claude Code's deferred-tool cache may not reflect mid-session additions
  without an explicit `/mcp` reconnect. This is a platform limitation — the
  server registers the tools correctly, but the client's cached tool schema
  may be stale.
- The `ToolSearch` tool in Claude Code can discover newly registered tools, but
  the schema cache refresh depends on the client implementation.

### Type Mapping

Extension tool `input_schema` properties are converted from JSON Schema types
to Zod validators:

| JSON Schema type | Zod equivalent |
|------------------|---------------|
| `string`         | `z.string()`  |
| `number`         | `z.number()`  |
| `integer`        | `z.number().int()` |
| `boolean`        | `z.boolean()` |
| `array`          | `z.array(z.any())` |
| nested `object`  | `z.any()` (fallback) |

### Deletion Edge Cases

- **GDScript deletion while loaded:** Handler becomes unreachable. Next tool
  call returns a bridge error (method not found). On the next filesystem scan
  (~500ms), the tool is automatically unregistered.
- **C# deletion while loaded:** The compiled DLL retains the class until
  rebuild. Tool remains callable with stale behavior until `dotnet build`
  re-runs, at which point the class drops from the global list and the tool
  is unregistered.
