# Compatibility Notes

## Error Contract

### Parameter validation: which layer rejects, by entry point

Two layers validate tool parameters, and **which one rejects a bad value depends
on how the call arrives**:

- **Through the MCP server (every Claude / agent call):** parameters are checked
  against the server's Zod schema *before* the request reaches the Godot plugin.
  A value that violates an **enum** constraint — e.g. `texture_generate shape`,
  `sound_generate waveform`, `scene_spatial_map detail`, `if_exists` — is rejected
  by the MCP SDK as JSON-RPC **`-32602` (Invalid params)**, with the message
  naming the offending parameter. This fails fast, with no editor round-trip.
- **Direct plugin dispatch** (the toolkit's own `sv2_` GDScript sweep driver, or
  extension tools that declare no server-side enum): the request bypasses the
  server's Zod layer and reaches the plugin handler, whose own validation returns
  the toolkit error code **`INVALID_PARAMS`**.

Both are correct and intentional — not a bug. The server-side enum is the
fast-fail, self-documenting path for agents; the plugin-side check is
defense-in-depth for anything that reaches the plugin directly. **Non-enum**
guards (range clamps, mutually-exclusive params, semantic checks the JSON schema
cannot express) always reach the plugin and surface as `INVALID_PARAMS`
regardless of entry point.

> **For test authors:** a sweep driven by an **MCP agent** sees `-32602` for an
> invalid enum; the **GDScript `sv2_` driver** sees `INVALID_PARAMS` for the same
> input. Assert per the path you are exercising. (Smoke `bridge.call` is the
> direct-dispatch path → `INVALID_PARAMS`; see smoke §46 `texture bad shape` /
> `sound bad waveform`.)

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
