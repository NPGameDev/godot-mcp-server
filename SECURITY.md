# Security Policy

## Reporting a vulnerability

Please report suspected vulnerabilities privately through
[GitHub Security Advisories](https://github.com/NPGameDev/godot-mcp-server/security/advisories):
open the repository's **Security** tab and choose **Report a vulnerability**.
Do not open a public issue for a suspected vulnerability.

We aim to acknowledge every report within 7 days, and we will keep you informed
as we investigate and fix the problem.

If the issue lives in the Godot editor plugin rather than this MCP server,
report it in the
[godot-mcp-toolkit repository](https://github.com/NPGameDev/godot-mcp-toolkit/security/advisories)
instead — same process. When in doubt, report it here and we will route it.

## Supported versions

| Version | Supported |
| --- | --- |
| Pre-release (`main`) | Yes — security fixes land on `main` |
| From 1.0 onward | The latest release |

Until the first tagged release, `main` is the only line that receives fixes.
After 1.0, security fixes target the latest release; upgrading is the supported
path.

## Security model in one paragraph

The server is a local process your MCP client launches: it speaks MCP over
stdio to the client and opens no listening sockets of its own — it only *dials*
out, to the plugin's WebSocket servers and to Godot's GDScript language server,
all on `127.0.0.1`. Every WebSocket connection authenticates with the
per-project session token the plugin generates on each start; the server reads
the token from the plugin's per-project instance directory and validates the
published path before using it. Setting `GODOT_MCP_READ_ONLY=1` is enforced
here, server-side: every mutating tool is left unregistered, so it never
appears in the client's tool list at all, regardless of what the client or the
model asks for. The deeper protections — the project-root filesystem guard, the
append-only audit log, response size caps, and the untrusted-content envelopes
— live in the plugin, which is the authoritative side; this server forwards its
results and adds the read-only policy layer.

**Network defaults:** the server listens on nothing. Everything it connects to
binds `127.0.0.1` only, on the plugin's side. Nothing is ever exposed to the
network.

## What no setting can promise

A Godot project is a code-execution environment: the engine runs GDScript, and
this toolchain exists so an AI agent can drive it — including executing code in
the editor or the running game. No configuration of this server makes that
100% safe. Read-only mode, the plugin's filesystem guard, and your MCP client's
own permission prompts reduce the blast radius; they do not eliminate it.

If you want stronger isolation, run the whole setup — editor, server, and
agent — inside a boundary you control: a container (the cleanest fit for
headless work), a virtual machine (isolates everything, GUI included), a
restricted OS account, blocked outbound network access, or a disposable
environment. These are suggestions to layer on top of the defaults, not
turnkey recipes. The
[toolkit's security policy](https://github.com/NPGameDev/godot-mcp-toolkit/blob/main/SECURITY.md)
carries the fuller version of this guidance.

## More detail

The security model is documented on the plugin's side — the plugin owns the
guards; this server summarizes and links:

- The [Security section of this README](README.md#security) — the security
  features at a glance.
- The
  [toolkit security policy](https://github.com/NPGameDev/godot-mcp-toolkit/blob/main/SECURITY.md)
  — the full model and hardening guidance.
- The shipped
  [security recommendations](https://github.com/NPGameDev/godot-mcp-toolkit/blob/main/addons/godot_mcp_toolkit/docs/security-recommendations.md)
  — per-tool risk notes and recommended client-side permission rules.
