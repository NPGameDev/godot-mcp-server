# CLAUDE.md — godot-mcp-server

Guidance for Claude Code (claude.ai/code) when **editing this repo's TypeScript
source**. If you are instead calling MCP tools from the plugin, see the toolkit
repo's `CLAUDE.md` (user-facing tool list + conventions).

---

## What this repo is

The TypeScript MCP server that bridges Claude Code (stdio) to the `godot-mcp-toolkit`
Godot editor plugin (WebSocket `127.0.0.1:6505`). Repo root IS the npm package
root — no `server/` subdir wrapper. Distributed via `npm install -g godot-mcp-server`
(or `npx godot-mcp-server`).

## Architecture

- `src/index.ts` — entry. Constructs one `McpServer`, one `Bridge`, registers
  tool groups, connects the `StdioServerTransport`.
- `src/bridge.ts` — WebSocket client (lazy-connect, pending-map keyed by uuid,
  per-call timeout). Exposes `Bridge.call(method, params, timeoutMs)` and `close()`.
- `src/types.ts` — `Bridge` interface + `BridgeError` class. Tool modules depend
  on `Bridge`, NOT on the concrete `createBridge` function (DIP).
- `src/tools/<group>.ts` — one file per logical group (`scene`, `node`, `script`,
  `editor`). Each exports a typed `ToolDef[]` and a `register(server, bridge)`
  function. `ToolDef` is defined in `tools/scene.ts` and re-exported implicitly
  (via `import { ToolDef } from "./scene.js"`).
- `test/smoke.ts` — harness. **Port-check first** (iter 05 contract) then round-trip
  assertions. Do NOT move the port-check below the assertions — it exits with
  instructions when the editor is down.

## Invariants for agents editing this repo

- **I1 — error contract.** Tools never throw past the bridge. Plugin-side errors
  come back as `{ success: false, error, code }` payloads; wrap them into MCP
  responses with `isError: true` (iter 14 formalises).
- **I2 — description ≤ 200 chars.** Enforced by smoke. Tight descriptions help
  Claude Code pick the right tool.
- **I4 — path rule.** All `res://` path input eventually passes through
  `FileGuard.resolve_safe` (plugin side, iter 18). For now, callers leave
  `TODO(iter-18)` at each path-touching call site.
- **I6 — localhost-only.** Bridge URL is `ws://127.0.0.1:${GODOT_MCP_PORT}`.
  Never allow a non-loopback host.
- **I7 — one commit per iteration per repo.** Conventional-commit form:
  `feat(server): …`, `fix(server): …`, `refactor(server): …`.
- **I8 — rollback granularity.** `git revert <sha>` cleanly undoes one iteration's
  server-side work.

## Workflow

```
npm install          # once
npm run build        # tsc -> dist/, postbuild adds shebang
npm run smoke        # port-check + round-trip assertions (editor must be up)
npm link             # dogfood: global `godot-mcp-server` resolves to this dist/
```

`.mcp.json` uses `npx godot-mcp-server` — so `npm link` makes the dogfood loop
work without touching any config. After publish to npm the same `.mcp.json`
works for end users with no edits.

## Adding a tool

1. Append a `ToolDef` to the appropriate group file (`src/tools/<group>.ts`).
2. Keep `description` ≤ 200 chars (I2).
3. If the tool returns non-text content (images, binary), handle it explicitly
   in that group's `register()` function — see `editor.ts` `editor_screenshot`
   for the image path.
4. Add a smoke-test round-trip assertion under the existing ones in
   `test/smoke.ts`, appended (never re-ordered — port-check must stay first).
5. Update the tool count in the smoke-test assertion and the toolkit-repo
   `CLAUDE.md` "tool list" section.

## Pointers

- Execution plan (all 26 iterations, cross-repo): `<plan-repo>/Plan/ExecutionPlan/00-index.md`
- Companion plugin: `<toolkit-repo>/` — see its `CLAUDE.md` for tool usage.
- Distribution procedure: `<toolkit-repo>/DISTRIBUTION.md`.
