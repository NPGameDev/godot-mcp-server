# Godot MCP Server

TypeScript MCP server that lets Claude Code (or any MCP-compatible client) drive the **Godot 4.x editor** via its companion `godot-mcp-toolkit` plugin. This process runs a local stdio MCP server and bridges it to the Godot editor over WebSocket (`127.0.0.1:6505`, localhost-only).

## Install

```
npm install -g godot-mcp-server
```

Or invoke directly via `npx godot-mcp-server` — the shipped `.mcp.json` examples use `npx` so end users don't need a global install.

## Layout

- `src/` — TypeScript source. The server-repo root IS the npm package root (no `server/` subdir wrapper).
- `dist/` — compiled output (`tsc`-generated, gitignored).
- `src/index.ts` — entry point. Exposed as the `godot-mcp-server` binary via `package.json#bin`.
- `src/bridge.ts` — WebSocket client to the Godot-side toolkit plugin.
- `src/tools/` — per-tool definitions (one file per MCP tool).

## Companion plugin

This server is useless on its own — you also need the **Godot 4.x editor plugin** from the sibling toolkit repo:

- Source / AssetLib submission: <https://github.com/NPGameDev/godot-mcp-toolkit>
- Install inside Godot via AssetLib, or drop `addons/godot_mcp_toolkit/` into your project. Enable via Project Settings → Plugins.

## Status

Iteration 01b (scaffold). The full execution plan — 26 iterations across toolkit + server — lives in the sibling planning repo: <https://github.com/NPGameDev/godot-mcp-creation> → `Plan/ExecutionPlan/00-index.md`.
