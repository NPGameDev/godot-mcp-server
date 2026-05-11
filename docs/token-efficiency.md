# Token Efficiency

How much context window does the MCP catalogue consume? This page provides concrete numbers for each profile so you can choose the right one for your workflow.

## Catalogue cost by profile

When your MCP client connects, the server sends a `tools/list` response containing every tool in the active profile. This is the one-time cost of registering the toolkit in the model's context.

| Profile | Tools | Catalogue size | Est. tokens |
|---------|------:|---------------:|------------:|
| **Minimal** | 13 | 5.2 KB | ~1,300 |
| **Standard** | 38 | 14.1 KB | ~3,600 |
| **Standard + all groups** | 60 | 22.7 KB | ~5,800 |
| **Power User** | 59 | 22.4 KB | ~5,700 |

Sizes shown are with schema minification enabled (the default). Token estimates use the standard bytes/4 heuristic.

**Standard vs Power User:** The standard profile starts at ~3,600 tokens and grows incrementally as you load groups on demand. Power User registers everything up front at ~5,700 tokens. The difference is modest — choose based on whether you want on-demand loading or immediate access.

## Which profile should I use?

| Use case | Profile | Token cost |
|----------|---------|-----------|
| Code review, exploration, learning | **Minimal** | ~1,300 tokens |
| Day-to-day Godot development | **Standard** | ~3,600 tokens (+ groups as needed) |
| Full engine access, advanced workflows | **Power User** | ~5,700 tokens |

- **Minimal** gives you 13 read-only tools: scene inspection, script reading, class lookups, script validation. Enough for understanding a project without modifying it.
- **Standard** gives you 34 core editing tools plus `discover_tools` for on-demand access to 34 additional tools across 10 groups. This is the sweet spot for most workflows — you pay for specialized tools only when you need them.
- **Power User** unlocks everything including feature-gated tools (`game_eval`, `node_call_method`, `project_set_setting`). The token overhead vs standard-with-all-groups is negligible; the difference is immediate availability vs on-demand loading.

## On-demand group costs

In the standard profile, specialized tool groups are loaded via `discover_tools`. Each group adds a known token cost:

| Group | Tools | Added tokens |
|-------|------:|------------:|
| runtime | 5 | ~450 |
| signals | 3 | ~320 |
| animation_authoring | 2 | ~260 |
| input_map | 2 | ~200 |
| asset_management | 6 | ~580 |
| user_data | 4 | ~370 |

Loading all 6 groups adds ~2,200 tokens to the standard profile baseline.

## Schema minification savings

The server applies schema minification (stripping `additionalProperties`, `$schema`, compressing parameter descriptions) to reduce catalogue size:

| Profile | Before | After | Reduction |
|---------|-------:|------:|----------:|
| Minimal | 6.5 KB | 5.2 KB | 20% |
| Standard | 17.3 KB | 14.1 KB | 18% |
| Power User | 27.6 KB | 22.4 KB | 19% |

Minification saves ~19% across all profiles. This is enabled by default and requires no configuration.

## Per-tool cost range

- **Heaviest:** `classdb_get_info` at ~160 tokens (rich schema with section filters and inheritance options)
- **Lightest:** `editor_reload_scripts` at ~63 tokens (no parameters)
- **Average:** ~97 tokens per tool

Tools with more parameters and detailed descriptions cost more tokens. All descriptions stay under the 200-character limit (I2 invariant); the average is 130 characters.

## How to measure

Rerun the measurement script after adding or modifying tools:

```bash
npx tsx scripts/measure-tokens.ts
```

The script imports all tool definitions, converts their Zod schemas to JSON Schema (matching the MCP wire format), and measures per-profile catalogue sizes with and without minification. Feature gates are temporarily enabled during measurement to capture the complete catalogue.
