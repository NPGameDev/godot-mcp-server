# AGENTS.md

Guidance for AI coding agents working in this repository. This is the
tool-agnostic doc map; Claude Code reads the fuller, Claude-specific
[`CLAUDE.md`](CLAUDE.md) instead.

This repo is the **Godot MCP Server** — the TypeScript MCP bridge (an npm
package) that connects an MCP client to the Godot MCP Toolkit plugin. The repo
root is the npm package root.

## Read these first

Read in order before making changes:

1. [`docs/architecture/README.md`](docs/architecture/README.md) — subsystems,
   the contract surface, and the transport, with diagrams.
2. [`docs/dev/code-standards.md`](docs/dev/code-standards.md) — idiomatic
   TypeScript/Node style, naming, and comment conventions. Follow these for all
   code you write.
3. [Toolkit `docs/dev/contract.md`](https://github.com/NPGameDev/godot-mcp-toolkit/blob/main/docs/dev/contract.md)
   — the request/response and transport contract between the toolkit and the
   server. The toolkit owns it; read before touching the bridge, response
   handling, or the wire protocol.
4. [`docs/dev/glossary.md`](docs/dev/glossary.md) — the project's shared
   vocabulary.

For the rationale behind larger design choices, the trail is the commit history
and the architecture document above — this repo does not keep a separate
decision-record directory.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for environment setup, how to run
checks, the commit format, and the pull-request checklist.
