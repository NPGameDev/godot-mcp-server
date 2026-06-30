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
