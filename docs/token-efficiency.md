# Token Efficiency

How much context window does the MCP catalogue consume? This page provides concrete numbers so you can estimate the cost of registering the toolkit in your model's context.

The numbers below are a generated snapshot (2026-10-24). Regenerate them any time with `npm run measure:tokens` — see [How to measure](#how-to-measure).

## Catalogue cost

When your MCP client connects, the server sends a `tools/list` response containing every eagerly-registered tool. Additional tools are loaded on demand via `discover_tools`.

| Surface | Tools | Bytes | Est. tokens |
|---------|------:|------:|------------:|
| **Startup surface** | 36 | 38,107 | ~9,527 |
| **Full surface** | 115 | 116,305 | ~29,077 |
| **Read-only mode** | 42 | 34,599 | ~8,650 |

Token estimates use the standard bytes/4 heuristic.

- **Startup surface** — the eager tools plus the two meta tools (`discover_tools`, `extensions_refresh`), always in the initial `tools/list`.
- **Full surface** — the startup surface with every on-demand group activated: the 113 built-in tools plus the two meta tools.
- **Read-only mode** (`GODOT_MCP_READ_ONLY=1`) — mutating tools filtered out, leaving the read-only set plus the two meta tools, with every group activated.

The startup surface starts at ~9,500 tokens and grows incrementally as you load groups on demand.

## On-demand group costs

Specialized tool groups are loaded via `discover_tools`. Each group adds a known token cost on top of the startup surface. All 28 groups:

| Group | Tools | Incremental bytes | Incremental tokens |
|-------|------:|------------------:|-------------------:|
| runtime_advanced | 3 | 2,116 | ~529 |
| signals | 1 | 541 | ~136 |
| animation_authoring | 4 | 3,852 | ~963 |
| input_map | 3 | 3,350 | ~838 |
| resource_io | 2 | 1,215 | ~304 |
| asset_ops | 3 | 2,111 | ~528 |
| placeholders | 2 | 3,152 | ~788 |
| cleanup | 6 | 2,737 | ~685 |
| user_data | 4 | 1,996 | ~499 |
| scene_advanced | 2 | 1,809 | ~453 |
| editor_advanced | 3 | 2,668 | ~667 |
| tilemap | 2 | 2,422 | ~606 |
| tileset | 6 | 6,898 | ~1,725 |
| tileset_edit | 5 | 4,124 | ~1,031 |
| theme | 1 | 1,256 | ~314 |
| layer_naming | 2 | 1,017 | ~255 |
| path_editing | 2 | 2,160 | ~540 |
| 3d_tools | 4 | 7,458 | ~1,865 |
| procedural | 3 | 4,110 | ~1,028 |
| scene_inheritance | 1 | 710 | ~178 |
| audio | 2 | 1,824 | ~456 |
| spriteframes | 3 | 5,189 | ~1,298 |
| particles | 1 | 5,024 | ~1,256 |
| navigation | 1 | 1,213 | ~304 |
| lsp_code_analysis | 4 | 2,609 | ~653 |
| lsp_code_navigation | 3 | 2,454 | ~614 |
| debugger | 4 | 1,749 | ~438 |
| classdb | 2 | 2,546 | ~637 |

Group costs scale with the size and description length of the tools they carry; `discover_tools` reports the exact incremental cost when you activate a group.

## Per-tool cost range

- **Heaviest:** `particles_create` (~1,256 tokens) — a large parameter schema with many typed fields
- **Lightest:** `audiobus_list` (~77 tokens) — parameterless, description only
- **Average:** ~985 bytes (~247 tokens) per tool

Tools with more parameters and detailed descriptions cost more tokens. Most descriptions stay under the 200-character limit (I2 invariant), with documented waivers for action-consolidated tools that document per-operation behavior.

## How to measure

Rerun the measurement script after adding or modifying tools:

```bash
npm run measure:tokens
```

The script imports all tool definitions, converts their Zod schemas to JSON Schema the way `tools/list` sends them (the server's string coercion, then the MCP SDK's converter), and measures catalogue sizes per surface. Tool counts agree with `godot-mcp-server --tools-count`.
