# godot-mcp-server

TypeScript MCP server that lets Claude Code (or any MCP-compatible client) drive
the **Godot 4.x editor** via its companion `godot-mcp-toolkit` plugin. This
process is a local stdio MCP server; it forwards each tool call over a
localhost WebSocket (`127.0.0.1:6505`) to the plugin running inside the editor.

## Install

```
npm install -g godot-mcp-server
```

The shipped `.mcp.json` examples use `npx godot-mcp-server`, so end users don't
strictly need the global install — but the global install makes startup faster
and keeps the same command name on every machine.

## Configure Claude Code

In the Godot project you want Claude to drive, drop a `.mcp.json` at the project
root:

```json
{
  "mcpServers": {
    "godot-mcp-toolkit": {
      "command": "cmd",
      "args": ["/c", "npx", "godot-mcp-server"],
      "env": { "GODOT_MCP_PORT": "6505" }
    }
  }
}
```

On Linux / macOS, drop the `cmd /c` wrapper:

```json
"command": "npx",
"args": ["godot-mcp-server"]
```

The companion plugin ships this file as
`addons/godot_mcp_toolkit/.mcp.json.template`; copy it up one level into the
project root once the plugin is installed. Iter 21 adds an editor menu item
that writes it for you.

## Environment

| Variable          | Default | Purpose                                                |
|-------------------|---------|--------------------------------------------------------|
| `GODOT_MCP_PORT`  | `6505`  | Port on `127.0.0.1` the Godot plugin is listening on.  |

Localhost-only by design — the server will not connect to non-loopback hosts.

## Companion plugin (required)

This process is useless without the Godot editor side. Install the
`godot-mcp-toolkit` plugin:

- Source + install instructions: <https://github.com/NPGameDev/godot-mcp-toolkit>
- Godot AssetLib listing (after first submission): search "Godot MCP Toolkit"
  inside the editor's AssetLib tab.

See the toolkit repo's [`DISTRIBUTION.md`](https://github.com/NPGameDev/godot-mcp-toolkit/blob/main/DISTRIBUTION.md)
for the full cross-repo release + end-user install procedure.

## Layout

- `src/` — TypeScript source. Repo root IS the npm package root (no `server/`
  subdir wrapper).
- `dist/` — compiled output (`tsc`-generated, gitignored).
- `src/index.ts` — entry; exposed as the `godot-mcp-server` binary via
  `package.json#bin`.
- `src/bridge.ts` — WebSocket client.
- `src/tools/` — per-group tool definitions.
- `test/smoke.ts` — smoke harness (`npm run smoke`).
- `scripts/add-shebang.mjs` — postbuild step that prepends `#!/usr/bin/env node`
  to `dist/index.js` so `npx` / global install both work on POSIX shells.

## Status

MVP (iteration 08 of 26). The full execution plan — toolkit + server — lives in
the planning repo: <https://github.com/NPGameDev/godot-mcp-creation>.

**Do not publish to npm or tag releases before iteration 20 completes.** Iters
18–20 add transport auth, filesystem sandbox, response caps, and audit
logging; until they land, this stack is for internal dogfood only. See the
toolkit repo's `DISTRIBUTION.md` for the security gate.

## Licence

MIT — see [`LICENSE`](./LICENSE). Upstream notices in
[`ATTRIBUTIONS.md`](./ATTRIBUTIONS.md).
