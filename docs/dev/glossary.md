# Domain Glossary — Server

The domain glossary is **toolkit-owned** — `docs/dev/glossary.md` in the toolkit repo is the
cross-repo single source of truth for the project's shared vocabulary (the multi-session concurrency
model, editor-responsiveness throttle, test layers, hint surface, coverage counting, and internal
module roles). This server repo **cross-links** that glossary rather than restating it.

When a term in this repo's code, comments, contract notes, or `code-standards.md` needs a
definition, read the toolkit's `docs/dev/glossary.md`. This file defines only the term(s) the
**server** owns.

## Server-owned term

**Bridge**
The server itself — the TypeScript MCP bridge process: it connects an MCP client (e.g. Claude Code)
over stdio to the Godot editor's toolkit over WebSocket, translating MCP `tools/call` requests into
toolkit JSON-RPC commands and the responses back. The editor (toolkit) side has **no** "bridge"; a
toolkit-side component is never called a bridge.

## Channel vocabulary

The **user-facing** names for the two live WebSocket connections the bridge dials. The toolkit
glossary carries the full treatment; these entries pin the canon as it applies server-side.

**Editor channel**
The connection to the WebSocket server inside the Godot **editor** (default port 6550). The
persistent, reconnecting channel; most tools dispatch through it. Internal host label: *Mode A* —
code comments, ADRs, and the contract doc only; it never appears in user-facing docs.
_Avoid_: Mode A (user-facing); "editor server" (collides with **Bridge**); "editor mode" (collides
with **Read-only mode**); "editor context" (overloaded).

**Runtime channel**
The connection to the WebSocket server inside the **running game** (default port 6570), live only
during a playtest. Discovered, non-reconnecting, heartbeat-monitored. Plain-English gloss in user
prose: **the running game**. Internal host label: *Mode B* — same rule as Mode A.
_Avoid_: Mode B (user-facing); "runtime server" (collides with **Bridge**); "runtime mode" /
"runtime context" (see above).

**Noun-light rule.** User-facing prose prefers bare adjectives ("editor tools", "the running
game"); the "channel" noun appears only where the transport itself is the subject (the architecture
doc, the runtime-port configuration note). Two tools carry a **channel selector** with
inconsistent vocabularies (a known inconsistency, kept until deliberately unified):
`signal_emit.mode: "editor" | "runtime"` (default `editor`) and
`execute_code.context: "game" | "editor"` (default `game` — the running game).

## Surface vocabulary

How this project names **which tools a connected client sees**. Two orthogonal axes: how much of
the catalogue is loaded, and whether mutating tools are visible.

**Startup surface**
The tools exposed immediately on connect — the always-on core plus the meta tools; what
`tools/list` returns before any group is activated.

**Full surface**
The startup surface plus every on-demand group activated via `discover_tools`. A ceiling ("up
to") — some tools and operations are Godot-version-gated, so older supported versions expose fewer.

**Read-only mode**
The orthogonal switch (`GODOT_MCP_READ_ONLY=1`) that hides every mutating tool — enforced here,
server-side: an excluded tool is never registered, so it is absent from `tools/list` entirely. A
filter on whichever surface is active — not a mode of its own, and not a profile.

Retired vocabulary — never present these as user-facing modes: "Standard", "Power User",
"Minimal", "Custom", "Full profile", `GODOT_MCP_PROFILE`, `GODOT_MCP_CUSTOM_TOOLS`,
`enable_tool_group`.
