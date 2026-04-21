# Contributing to Godot MCP Server

Thank you for your interest in contributing! This guide covers everything you
need to get started.

## Prerequisites

- **Node.js >= 20**
- **Godot 4.x** (4.4+ recommended, for running the companion plugin)
- **Git**

This project spans three repositories that live as siblings on disk:

| Repo | What it is |
|------|-----------|
| [`godot-mcp-toolkit`](https://github.com/NPGameDev/godot-mcp-toolkit) | Godot editor plugin (GDScript) |
| [`godot-mcp-server`](https://github.com/NPGameDev/godot-mcp-server) (this repo) | TypeScript MCP bridge (npm package) |
| [`godot-mcp-creation`](https://github.com/NPGameDev/godot-mcp-creation) | Execution plan and design docs |

Clone all three as siblings:

```bash
git clone https://github.com/NPGameDev/godot-mcp-toolkit.git
git clone https://github.com/NPGameDev/godot-mcp-server.git
git clone https://github.com/NPGameDev/godot-mcp-creation.git  # optional, for plan context
```

## Dev environment setup

### 1. Install and build

```bash
cd godot-mcp-server
npm install
npm run build    # tsc -> dist/
```

### 2. Start the Godot plugin

Open the toolkit repo root in Godot 4.4+, then enable the plugin:

**Project Settings -> Plugins -> "Godot MCP Toolkit" -> Active**

Leave the editor running. The server connects to the plugin's WebSocket on
`127.0.0.1:6505`.

### 3. Verify the connection

```bash
npm run smoke
```

The smoke test port-checks `127.0.0.1:6505`. If nothing is listening, it prints
instructions and exits. Make sure the Godot editor is running with the plugin
enabled.

## Running checks

### Linting

```bash
npm run lint         # ESLint (src/ and test/)
```

ESLint uses flat config (`eslint.config.js`) with typescript-eslint recommended
rules and eslint-config-prettier.

### Formatting

```bash
npm run format       # Prettier check (all files)
npm run format:fix   # auto-fix formatting
```

Prettier config: 2-space indent, double quotes, semicolons, trailing commas,
120-char print width.

### Smoke test

```bash
npm run smoke        # dual-pass: gates-off then gates-on
npm run smoke:single # single pass (inherits your env vars)
```

The Godot editor must be running with the plugin enabled for smoke tests to pass.

### Build

```bash
npm run build        # TypeScript -> dist/
```

Always build before running smoke tests to pick up your changes.

## Dependency policy

All npm dependencies use **exact** versions (no `^` or `~` prefixes). This
ensures reproducible installs. Dependency updates are deliberate PRs, not
silent drift from caret ranges. When adding a dependency, pin it:

```bash
npm install --save-exact some-package
```

## Submitting changes

### Branch naming

Use descriptive branch names: `feat/add-x`, `fix/crash-on-y`,
`docs/update-readme`.

### Commit format

We use [Conventional Commits](https://www.conventionalcommits.org/). One commit
per logical change.

```
<type>(<scope>): <imperative description>
```

**Types:** `feat`, `fix`, `refactor`, `docs`, `chore`, `test`, `build`

**Scopes:** `server`, `tools`, `config`

**Examples:**
- `feat(server): add classdb_search tool`
- `fix(tools): handle disconnected bridge in callAndWrap`
- `docs(config): update environment variable table`

### Pull request checklist

- [ ] `npm run build` succeeds
- [ ] `npm run lint` passes
- [ ] `npm run format` passes
- [ ] Smoke test passes (`npm run smoke`)
- [ ] No unrelated changes included
- [ ] Commit message follows Conventional Commits format
- [ ] CHANGELOG.md updated if user-facing

### What makes a good PR

- **Small and focused.** One feature or fix per PR.
- **Tested.** Describe how you verified the change works.
- **Documented.** Update CLAUDE.md or inline comments if behavior changes.

## Adding a tool

See the "Adding a tool" section in [CLAUDE.md](CLAUDE.md) for the step-by-step
checklist.

## Architecture overview

For detailed context on the project's architecture, iteration history, and
design decisions, see the execution plan in the
[`godot-mcp-creation`](https://github.com/NPGameDev/godot-mcp-creation) repo:

`Plan/ExecutionPlan/00-index.md`

## Code of conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md).
Please read it before participating.

## Questions?

Open a [discussion](https://github.com/NPGameDev/godot-mcp-server/issues) or
file an issue. We're happy to help.
