# Token Efficiency

How much context window does the MCP catalogue consume? This page provides concrete numbers so you can estimate the cost of registering the toolkit in your model's context.

The numbers below are a generated snapshot (2026-07-26). Regenerate them any time with `npm run measure:tokens` — see [How to measure](#how-to-measure).

## Catalogue cost

When your MCP client connects, the server sends a `tools/list` response containing every eagerly-registered tool. Additional tools are loaded on demand via `discover_tools`.

| Surface | Tools | Bytes | Est. tokens |
|---------|------:|------:|------------:|
| **Startup surface** | 36 | 35,443 | ~8,861 |
| **Full surface** | 114 | 116,094 | ~29,024 |
| **Read-only mode** | 39 | 31,051 | ~7,763 |

Token estimates use the standard bytes/4 heuristic.

- **Startup surface** — the eager tools plus the two meta tools (`discover_tools`, `extensions_refresh`), always in the initial `tools/list`.
- **Full surface** — the startup surface with every on-demand group activated: the 112 built-in tools plus the two meta tools.
- **Read-only mode** (`GODOT_MCP_READ_ONLY=1`) — mutating tools filtered out, leaving the read-only set.

The startup surface starts at ~8,900 tokens and grows incrementally as you load groups on demand.

## On-demand group costs

Specialized tool groups are loaded via `discover_tools`. Each group adds a known token cost on top of the startup surface. All 28 groups:

| Group | Tools | Incremental bytes | Incremental tokens |
|-------|------:|------------------:|-------------------:|
| runtime_advanced | 3 | 2,218 | ~555 |
| signals | 1 | 575 | ~144 |
| animation_authoring | 4 | 4,017 | ~1,005 |
| input_map | 2 | 1,371 | ~343 |
| resource_io | 2 | 1,283 | ~321 |
| asset_ops | 3 | 2,213 | ~554 |
| placeholders | 2 | 3,220 | ~805 |
| cleanup | 6 | 2,941 | ~736 |
| user_data | 4 | 2,132 | ~533 |
| scene_advanced | 2 | 1,806 | ~452 |
| editor_advanced | 3 | 2,770 | ~693 |
| tilemap | 2 | 2,519 | ~630 |
| tileset | 6 | 7,247 | ~1,812 |
| tileset_edit | 5 | 4,294 | ~1,074 |
| theme | 1 | 1,319 | ~330 |
| layer_naming | 2 | 1,085 | ~272 |
| path_editing | 2 | 2,344 | ~586 |
| 3d_tools | 4 | 8,087 | ~2,022 |
| procedural | 3 | 4,328 | ~1,082 |
| scene_inheritance | 1 | 744 | ~186 |
| audio | 2 | 1,921 | ~481 |
| spriteframes | 3 | 5,494 | ~1,374 |
| particles | 1 | 5,638 | ~1,410 |
| navigation | 1 | 1,305 | ~327 |
| lsp_code_analysis | 4 | 2,745 | ~687 |
| lsp_code_navigation | 3 | 2,564 | ~641 |
| debugger | 4 | 1,885 | ~472 |
| classdb | 2 | 2,614 | ~654 |

Group costs scale with the size and description length of the tools they carry; `discover_tools` reports the exact incremental cost when you activate a group.

## Per-tool cost range

- **Heaviest:** `particles_create` (~1,409 tokens) — a large parameter schema with many typed fields
- **Lightest:** `audiobus_list` (~85 tokens) — parameterless, description only
- **Average:** ~1,021 bytes (~256 tokens) per tool

Tools with more parameters and detailed descriptions cost more tokens. Most descriptions stay under the 200-character limit (I2 invariant), with documented waivers for action-consolidated tools that document per-operation behavior.

## How to measure

Rerun the measurement script after adding or modifying tools:

```bash
npm run measure:tokens
```

The script imports all tool definitions, converts their Zod schemas to JSON Schema (matching the MCP wire format), and measures catalogue sizes per surface. Tool counts agree with `godot-mcp-server --tools-count`.
