---
title: MCP client setup
permalink: /mcp-clients/
nav_order: 4
---

# MCP client setup

How to register the Godot MCP server in each MCP client, with per-OS config
paths and the gotchas that actually bite. Every client launches the same
stdio server:

```
npx -y @npgamedev/godot-mcp-server
```

Run your client **from the Godot project root** — the server resolves the
project (and its editor connection) from the working directory.

**A note on verification.** Each snippet below comes from that client's
official documentation, current as of this page's last update. A snippet is
marked **tested** only once we have validated it end-to-end ourselves;
everything else is **documented, not yet verified**. Where a claim comes from
community reports rather than official docs, we say so.

## Claude Code

*Status: documented (verified against the official Claude Code docs), not yet
validated end-to-end.*

One command, run from the project root:

```bash
claude mcp add godot-mcp-toolkit -- npx -y @npgamedev/godot-mcp-server
```

Stdio is the default transport, so no extra flag is needed. By default this
registers the server for you in this project only (`--scope local`); use
`--scope project` to write the project-shared `.mcp.json` instead, and
`--env KEY=value` (before the `--`) to set environment variables.

If your project has the toolkit plugin installed, there is an even shorter
path: the editor writes the project's `.mcp.json` for you (the dock offers it,
and it is kept in sync automatically). With that file present, Claude Code
picks the server up on next launch — no `claude mcp add` needed.

The equivalent `.mcp.json` (project scope, shareable in version control):

```json
{
  "mcpServers": {
    "godot-mcp-toolkit": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@npgamedev/godot-mcp-server"]
    }
  }
}
```

Claude Code asks for approval before loading a project-scoped `.mcp.json`
server and before an agent writes that file — approve both once.

Verify the connection with `claude mcp list` (or `/mcp` inside a session) —
the server should show as connected while the Godot editor is open with the
plugin enabled.

## Windows: the `cmd /c` wrapper

On native Windows, `npx` is a `.cmd` shim, and some clients' process spawning
cannot execute it directly. The reliable form wraps the call:

```json
{
  "mcpServers": {
    "godot-mcp-toolkit": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "@npgamedev/godot-mcp-server"]
    }
  }
}
```

This is the form the toolkit's auto-generated `.mcp.json` uses on Windows. No
client's official documentation requires it, and several state that the plain
form works — but the wrapper is the widely community-verified fix when a
client on Windows fails to start the server with the plain `npx` command, and
it costs nothing when the plain form would have worked. If you run your
client under WSL, note that WSL and native Windows are separate worlds: the
client, Node, and the Godot editor must all be reachable from the same side,
and a WSL-side server cannot reach an editor's `127.0.0.1` listener on the
Windows side without extra networking setup.

## macOS: if a GUI-launched client won't connect

Modern GUI-launched MCP clients — Claude Desktop, VS Code, and Cursor —
capture your login shell's environment and resolve a bare `npx` to a
version-manager Node on their own, so the standard
`npx -y @npgamedev/godot-mcp-server` config connects whether you launch the
client from Finder/Dock or a terminal. If a client won't connect, launch it
from a terminal to see its error, confirm the config file is present and
valid, and confirm Node 22+ is installed (`node --version`). If your Node
lives behind a version manager whose init is only in `~/.zshrc`, move it into
`~/.zprofile` so login-shell launches see it too — or install Node from the
official [nodejs.org](https://nodejs.org) installer, which lands on the
default `PATH` with zero setup.

**Advanced fallbacks** (only if the standard config still won't connect):

- **`env.PATH` variant (e.g. Homebrew).** Keep `"command": "npx"` and put your
  Node directory on `env.PATH`. The `env` block **replaces** the inherited
  environment rather than extending it, so declare a full working `PATH`:

  ```json
  {
    "command": "npx",
    "args": ["-y", "@npgamedev/godot-mcp-server"],
    "env": { "PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" }
  }
  ```

- **Login-shell wrapper — last resort, not a safe default.**

  ```json
  { "command": "zsh", "args": ["-lc", "exec npx -y @npgamedev/godot-mcp-server"] }
  ```

  The stdio transport reserves the child's **stdout** for JSON-RPC — a single
  stray byte breaks the connection. A login shell **sources your startup files
  _before_ `exec` runs**, so any banner they print lands on stdout ahead of
  the handshake and corrupts it — and `exec` cannot un-emit bytes already
  written before it runs. With `-lc` (login, non-interactive) that noise comes
  from `~/.zprofile`, `~/.zshenv`, `/etc/zprofile`, and login/motd banners.
  Note the catch-22: `-lc` does **not** read `~/.zshrc`, so if your nvm/fnm
  init lives there the wrapper won't even find Node — and switching to an
  interactive shell (`-ilc`) to pick it up re-introduces the full
  startup-banner surface (Powerlevel10k, oh-my-zsh). Only consider this form
  if your login profile prints nothing on startup, and silence toolchain init
  (e.g. `nvm use --silent >/dev/null 2>&1`).

## Other clients

<details>
<summary><strong>Claude Desktop</strong></summary>

*Status: documented, not yet verified.*

macOS and Windows only (no Linux build). No project-scoped config — the
server entry is global, so set `GODOT_MCP_PROJECT_PATH` to point it at your
project:

| OS | Config file |
|----|-------------|
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |

Open it via **Settings → Developer → Edit Config** (the button creates the
file if missing), then add:

```json
{
  "mcpServers": {
    "godot-mcp-toolkit": {
      "command": "npx",
      "args": ["-y", "@npgamedev/godot-mcp-server"],
      "env": { "GODOT_MCP_PROJECT_PATH": "C:/path/to/your/godot-project" }
    }
  }
}
```

Restart Claude Desktop after editing. Documented Windows gotcha: if the
server fails with `ENOENT` and a literal `${APPDATA}` in the path, add the
expanded `"APPDATA": "C:\\Users\\you\\AppData\\Roaming\\"` to the `env`
block, and make sure npm is installed globally.

</details>

<details>
<summary><strong>Cursor</strong></summary>

*Status: documented, not yet verified.*

| Scope | Config file |
|-------|-------------|
| Project | `.cursor/mcp.json` |
| Global | `~/.cursor/mcp.json` |

```json
{
  "mcpServers": {
    "godot-mcp-toolkit": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@npgamedev/godot-mcp-server"]
    }
  }
}
```

Cursor's docs list `type` as required even though their own examples omit
it — including it is the safe form. `env` supports `${env:NAME}`
interpolation, and stdio servers also accept an `envFile`. On Windows, if the
server fails to start, use the `cmd /c` wrapper above (a community-verified
fix; Cursor's official docs don't cover it).

</details>

<details>
<summary><strong>Windsurf</strong></summary>

*Status: documented, not yet verified.*

Global config only: `~/.codeium/windsurf/mcp_config.json` (all platforms), or
manage it from the MCPs panel in Cascade. Same `mcpServers` shape as Cursor,
without the `type` field:

```json
{
  "mcpServers": {
    "godot-mcp-toolkit": {
      "command": "npx",
      "args": ["-y", "@npgamedev/godot-mcp-server"]
    }
  }
}
```

Windsurf caps Cascade at 100 tools total across all servers. This server fits
comfortably: it starts with a small always-on surface and loads further tool
groups only when the assistant asks for them.

</details>

<details>
<summary><strong>VS Code (Copilot agent mode)</strong></summary>

*Status: documented, not yet verified.*

The workspace config is `.vscode/mcp.json` — note the top-level key is
**`servers`**, not `mcpServers`:

```json
{
  "servers": {
    "godot-mcp-toolkit": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@npgamedev/godot-mcp-server"]
    }
  }
}
```

For a user-level (all projects) entry, use the Command Palette →
**"MCP: Open User Configuration"** — VS Code's docs route through the palette
rather than documenting a literal path. Alternatives: **"MCP: Add Server"**
from the palette, or `code --add-mcp '{"name":"godot-mcp-toolkit",...}'` from
a terminal. `env` accepts values plus `${workspaceFolder}` and prompted
`${input:...}` variables.

</details>

<details>
<summary><strong>Cline</strong></summary>

*Status: documented, not yet verified.*

Cline's config file location has moved between releases, so use the UI, which
always opens the right file: click the **MCP Servers** icon in the Cline
panel, then **Configure MCP Servers**. The shape is the familiar
`mcpServers` object plus two Cline-specific fields:

```json
{
  "mcpServers": {
    "godot-mcp-toolkit": {
      "command": "npx",
      "args": ["-y", "@npgamedev/godot-mcp-server"],
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

</details>

<details>
<summary><strong>Codex CLI</strong></summary>

*Status: documented, not yet verified.*

Config is TOML at `~/.codex/config.toml` (a project-scoped
`.codex/config.toml` is honored only for trusted projects). One table per
server:

```toml
[mcp_servers.godot-mcp-toolkit]
command = "npx"
args = ["-y", "@npgamedev/godot-mcp-server"]
```

Or from the terminal:

```bash
codex mcp add godot-mcp-toolkit -- npx -y @npgamedev/godot-mcp-server
```

One documented gotcha worth knowing: Codex's default server startup timeout
is 10 seconds, and a cold `npx` run that has to download the package first
can exceed it. Either install the package globally once
(`npm install -g @npgamedev/godot-mcp-server`) or raise
`startup_timeout_sec` on the server's table.

</details>

<details>
<summary><strong>Gemini CLI</strong></summary>

*Status: documented, not yet verified.*

The `mcpServers` object lives inside the general settings file —
`~/.gemini/settings.json` (user) or `.gemini/settings.json` (project). It
shares that file with every other CLI setting, so edit carefully:

```json
{
  "mcpServers": {
    "godot-mcp-toolkit": {
      "command": "npx",
      "args": ["-y", "@npgamedev/godot-mcp-server"]
    }
  }
}
```

Or from the terminal: `gemini mcp add godot-mcp-toolkit npx -y @npgamedev/godot-mcp-server`
(env vars via repeated `-e KEY=value`). Values in `env` may reference the
shell environment as `$VAR` or `${VAR}`.

</details>

<details>
<summary><strong>Any other stdio client</strong></summary>

*Status: documented, not yet verified.*

Any client that can spawn a local stdio MCP server works. The essentials:

- **Command:** `npx` with args `["-y", "@npgamedev/godot-mcp-server"]` (or
  install globally and use `godot-mcp-server` as the command).
- **Working directory:** the Godot project root — or set
  `GODOT_MCP_PROJECT_PATH` in the server's environment if the client does not
  let you control the working directory.
- **Environment:** see the environment-variable table in the
  [README](../README.md#configuration) — everything is optional; discovery
  handles ports automatically.

</details>

## Pinning ports

With no configuration, the server discovers the editor's port automatically
through the shared project registry — including multiple editors and git
worktrees side by side. Pin a port only when you need a deterministic setup
(CI, containers, unusual network policies).

> [!IMPORTANT]
> A pinned port must be pinned on **both** sides with the same value: the
> editor binds where *its* environment says, and the server dials where
> *yours* says. Setting `GODOT_MCP_EDITOR_PORT` in `.mcp.json` pins the
> server only — if the editor was launched without the same value, the server
> dials a port nobody is listening on (it fails fast with a message naming
> the mismatch). If you don't want to manage this, don't pin — discovery
> needs no configuration.

The [README's configuration section](../README.md#configuration) documents
the variables and flags; the toolkit's shipped advanced-configuration doc
covers the editor's listen side.

## Permissions and read-only mode

**The hard guarantee is server-side.** Set `GODOT_MCP_READ_ONLY=1` in the
server's `env` block and every mutating tool is left unregistered — absent
from `tools/list` entirely, no matter what the client or the model asks for.
This is the mechanism to reach for in supervised settings (classrooms, demos,
reviewing an unfamiliar project):

```json
{
  "mcpServers": {
    "godot-mcp-toolkit": {
      "command": "npx",
      "args": ["-y", "@npgamedev/godot-mcp-server"],
      "env": { "GODOT_MCP_READ_ONLY": "1" }
    }
  }
}
```

**The convenience layer is annotations.** Every tool declares
`readOnlyHint` and `destructiveHint` in its metadata, so clients that read
MCP annotations can prompt differently for reads and writes. In Claude Code
you can auto-allow specific read-only tools in `settings.json`
(*documented, not yet verified*):

```json
{
  "permissions": {
    "allow": [
      "mcp__godot-mcp-toolkit__scene_get_tree",
      "mcp__godot-mcp-toolkit__scene_query",
      "mcp__godot-mcp-toolkit__script_read",
      "mcp__godot-mcp-toolkit__node_get_property"
    ]
  }
}
```

`mcp__godot-mcp-toolkit__*` allows every tool from the server — convenient,
but it removes the per-write prompt, so prefer listing read-only tools and
letting the client ask about mutations. The shipped
[security recommendations](https://github.com/NPGameDev/godot-mcp-toolkit/blob/main/addons/godot_mcp_toolkit/docs/security-recommendations.md)
carry per-tool risk notes and a fuller recommended ruleset.

## When it still won't connect

The [troubleshooting page](https://github.com/NPGameDev/godot-mcp-toolkit/blob/main/docs/troubleshooting.md)
has the 60-second checklist, a connectivity probe that works without an
editor, and symptom-to-fix entries for the common failure modes.
