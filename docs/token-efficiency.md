# Token Efficiency

How much context window does the MCP catalogue consume? This page provides concrete numbers so you can estimate the cost of registering the toolkit in your model's context.

## Catalogue cost

When your MCP client connects, the server sends a `tools/list` response containing every eagerly-registered tool. Additional tools are loaded on demand via `discover_tools`.

| Surface | Tools | Catalogue size | Est. tokens |
|---------|------:|---------------:|------------:|
| **Startup surface** | 36 | 34.6 KB | ~8,800 |
| **Full surface** | 114 | 113.3 KB | ~29,000 |
| **Read-only mode** | 39 | 30.3 KB | ~7,800 |

Token estimates use the standard bytes/4 heuristic.

- **Startup surface** — the eager tools plus the two meta tools (`discover_tools`, `extensions_refresh`), always in the initial `tools/list`.
- **Full surface** — the startup surface with every on-demand group activated.
- **Read-only mode** (`GODOT_MCP_READ_ONLY=1`) — mutating tools filtered out, leaving the read-only set.

The startup surface starts at ~8,800 tokens and grows incrementally as you load groups on demand.

## On-demand group costs

Specialized tool groups are loaded via `discover_tools`. Each group adds a known token cost on top of the startup surface:

| Group | Tools | Added tokens |
|-------|------:|------------:|
| tileset | 6 | ~1,812 |
| tileset_edit | 5 | ~1,074 |
| animation_authoring | 4 | ~1,005 |
| placeholders | 2 | ~805 |
| runtime_advanced | 3 | ~555 |
| signals | 1 | ~142 |

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
