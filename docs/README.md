---
title: Documentation
permalink: /
nav_order: 1
---

# Godot MCP Server — Documentation map

Every documentation surface of this repository, organized by what you want to
do. All of it lives here on GitHub — the npm package ships only the README, so
nothing under `docs/` travels with an install.

## Use it

- [Root README](../README.md) — what the server is, quickstart, configuration,
  security overview, and known limitations. Start here.
- [MCP client setup](mcp-clients.md) — per-client configuration for Claude
  Code, Claude Desktop, Cursor, Windsurf, VS Code, Cline, Codex CLI, and
  Gemini CLI, with per-OS paths, the Windows and macOS gotchas, and permission
  setup.
- [Tool reference](tool-reference/README.md) — the generated reference of
  every tool and operation. The canonical list; regenerated from the catalogue,
  never hand-edited.
- [Token efficiency](token-efficiency.md) — the measured context-window cost
  of the tool surface, and how the on-demand design keeps it small.
- [Troubleshooting](https://github.com/NPGameDev/godot-mcp-toolkit/blob/main/docs/troubleshooting.md)
  — the 60-second checklist, a connectivity probe, and symptom-to-fix entries.
  One canonical page for both repositories, hosted in the toolkit repo.

## Extend it

- [Extending the toolkit](https://github.com/NPGameDev/godot-mcp-toolkit/blob/main/addons/godot_mcp_toolkit/docs/extending.md)
  (toolkit, shipped) — the extension API: register your own MCP commands in
  GDScript; they appear to the assistant as tools through this server
  automatically.
- [Smoke-testing an extension](testing-locally.md#testing-an-extension) — how
  to validate your extension's tools over the MCP protocol against a live
  server, with a copy-paste template.

## Contribute to it

- [CONTRIBUTING](../CONTRIBUTING.md) — environment setup, checks, commit
  format, the PR checklist, and the documentation rules.
- [Testing locally](testing-locally.md) — every test layer, when to run it,
  and how to add coverage for a new tool.
- [Architecture](architecture/README.md) — subsystems, transport, the
  contract surface shared with the toolkit, and key decisions, with diagrams.
- [Code standards](dev/code-standards.md) — TypeScript style, async
  discipline, the MCP/SDK surface rules, and comment conventions.
- [Glossary](dev/glossary.md) — the server-owned vocabulary, cross-linked to
  the toolkit's fuller glossary.

## Who owns what

The toolkit and the server document some topics jointly. One repo is canonical
per topic; the other summarizes and links:

| Topic | Canonical owner | The other repo does |
|---|---|---|
| Security model | **toolkit** — shipped `security-recommendations.md` + repo `SECURITY.md` (policy) | server SECURITY.md mirrors policy; README summarizes + links |
| Client setup | **server** — `docs/mcp-clients.md` (GitHub) | toolkit README links it |
| Token efficiency | **server** — `docs/token-efficiency.md` (GitHub) | toolkit cites the headline figure + links |
| Compatibility | **toolkit** — shipped `addons/godot_mcp_toolkit/docs/compatibility.md` + Info-panel `res://` entry | server links the shipped doc on GitHub |
| Troubleshooting | **toolkit repo `docs/troubleshooting.md`** (GitHub, NOT shipped) — pinned URL below | server links the SAME URL; no server twin, no shipped copy |
| Tool reference | **server** — generated `docs/tool-reference/` | toolkit links it |
| Architecture | each repo its own `docs/architecture/README.md` | cross-link |

The pinned troubleshooting URL — link this exact address from both repos:

```
https://github.com/NPGameDev/godot-mcp-toolkit/blob/main/docs/troubleshooting.md
```

**Where a doc goes.** The toolkit addon is the only piece of this project that
ships documentation into a user's project; a doc ships there only if the
in-editor UI opens it through a `res://` path or it must legally travel with
the addon. Server documentation lives here on GitHub, linked by URL — the
README is the only page that travels with the npm package. See the
[Documentation section of CONTRIBUTING](../CONTRIBUTING.md#documentation) for
the full rules, including the generated files you must never hand-edit.
