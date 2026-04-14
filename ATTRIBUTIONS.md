# Attributions (godot-mcp-server)

This repo's TypeScript source was independently written. No code from any reference
repository has been copied verbatim or near-verbatim into `src/` or `test/`. The
entries below cover (a) runtime library dependencies whose licenses ship with the
installed package and (b) architectural references we studied while planning the
stack.

If future iterations import or adapt code from any of the sources below, append a
"Copied into: …" line with the file path(s) to keep this file accurate (per I10).

---

## modelcontextprotocol/typescript-sdk

Source: <https://github.com/modelcontextprotocol/typescript-sdk>
License: MIT (prior contributions) and Apache License 2.0 (new contributions)

Copyright (c) 2024-2025 Model Context Protocol a Series of LF Projects, LLC

Used as: runtime library dependency (npm: `@modelcontextprotocol/sdk`). No source
from the upstream repository is reproduced here. The installed npm package
carries its own LICENSE.

---

## Coding-Solo/godot-mcp

Source: <https://github.com/Coding-Solo/godot-mcp>
License: MIT

Copyright (c) 2025 Solomon Elias

Contributed (architecture reference only — no code copied): foundational MCP server
structure (stdio transport + tool registry pattern), bundled-GDScript handler
pattern, cross-platform Godot auto-detection, debug output capture.

---

## tugcantopaloglu/godot-mcp

Source: <https://github.com/tugcantopaloglu/godot-mcp>
License: MIT

Copyright (c) 2025 Tugcan Topaloglu
Copyright (c) 2025 Solomon Elias

Contributed (architecture reference only — no code copied): `game_eval` pattern
(arbitrary GDScript execution with return values and await support), signal
management system concepts, generic node property inspection via
`get_property_list()`, reentrancy guard pattern for concurrent command
prevention.

---

## ee0pdt/Godot-MCP

Source: <https://github.com/ee0pdt/Godot-MCP>
License: MIT

Copyright (c) 2025 (author unnamed in LICENSE)

Contributed (architecture reference only — no code copied): structural reference
for the two-layer plugin + TypeScript server architecture.

---

## tomyud1/godot-mcp

Source: <https://github.com/tomyud1/godot-mcp>
License: MIT

Copyright (c) 2025-2026 Tomer Yud

Contributed (architecture reference only — no code copied): reference
implementation for MCP server + Godot plugin integration.

---

## youichi-uda/godot-mcp-pro (architectural study of the TypeScript server layer)

Source: <https://github.com/youichi-uda/godot-mcp-pro>
License: MIT (plugin component); the TypeScript server component is separately
licensed.

Copyright (c) 2026 Youichi Uda (y1uda)

Contributed (architecture reference only — no code copied): WebSocket bridge
architecture (Node.js ↔ Godot editor plugin), JSON-RPC 2.0 over WebSocket
protocol design, full/lite/minimal deployment mode pattern.

---

## Sods2/claude-code-gdscript-lsp

Source: <https://github.com/Sods2/claude-code-gdscript-lsp>
License: MIT

Copyright (c) 2026 Alessandro Spano

Contributed (architecture reference only — no code copied): GDScript LSP bridge
architecture (stdio ↔ TCP), message-buffering pattern for when Godot is not
running.

---

## htdt/godogen

Source: <https://github.com/htdt/godogen>
License: MIT

Copyright (c) 2026 Alex Ermolov

Contributed (architecture reference only — no code copied): visual QA feedback
loop concept (screenshot + vision analysis after code generation).

---

## Notes

MIT only requires preserving notices for code that is directly copied or
substantially reproduced. None of the above are copied into this repository —
the entries document the architectural study we credit by courtesy. The
`@modelcontextprotocol/sdk` entry is the only one that represents a true runtime
dependency; its license ships inside the installed npm package.

The companion GDScript-side repository (`godot-mcp-toolkit`) carries its own
`ATTRIBUTIONS.md` with the subset of references relevant to the plugin.
