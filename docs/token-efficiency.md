# Token Efficiency

How much context window does the MCP catalogue consume? This page provides concrete numbers so you can estimate the cost of registering the toolkit in your model's context.

## Catalogue cost

When your MCP client connects, the server sends a `tools/list` response containing every eagerly-registered tool. Additional tools are loaded on demand via `discover_tools`.

| Configuration | Tools | Catalogue size | Est. tokens |
|---------------|------:|---------------:|------------:|
| **Standard (base)** | 38 | 14.1 KB | ~3,600 |
| **Standard + all groups** | 60 | 22.7 KB | ~5,800 |
| **Read-only mode** | ~24 | ~8.5 KB | ~2,100 |

Sizes shown are with schema minification enabled (the default). Token estimates use the standard bytes/4 heuristic.

The standard profile starts at ~3,600 tokens and grows incrementally as you load groups on demand. Read-only mode (`GODOT_MCP_READ_ONLY=1`) strips mutating tools, reducing the base catalogue.

## On-demand group costs

Specialized tool groups are loaded via `discover_tools`. Each group adds a known token cost:

| Group | Tools | Added tokens |
|-------|------:|------------:|
| runtime | 5 | ~450 |
| signals | 3 | ~320 |
| animation_authoring | 2 | ~260 |
| input_map | 2 | ~200 |
| asset_management | 6 | ~580 |
| user_data | 4 | ~370 |

Loading all 6 groups adds ~2,200 tokens to the standard baseline.

## Schema minification savings

The server applies schema minification (stripping `additionalProperties`, `$schema`, compressing parameter descriptions) to reduce catalogue size:

| Configuration | Before | After | Reduction |
|---------------|-------:|------:|----------:|
| Standard | 17.3 KB | 14.1 KB | 18% |
| Standard + all groups | 28.0 KB | 22.7 KB | 19% |

Minification saves ~19% and is enabled by default with no configuration.

## Per-tool cost range

- **Heaviest:** `classdb_get_info` at ~160 tokens (rich schema with section filters and inheritance options)
- **Lightest:** `editor_refresh` at ~63 tokens (no parameters)
- **Average:** ~97 tokens per tool

Tools with more parameters and detailed descriptions cost more tokens. All descriptions stay under the 200-character limit (I2 invariant); the average is 130 characters.

## How to measure

Rerun the measurement script after adding or modifying tools:

```bash
npx tsx scripts/measure-tokens.ts
```

The script imports all tool definitions, converts their Zod schemas to JSON Schema (matching the MCP wire format), and measures catalogue sizes with and without minification.
