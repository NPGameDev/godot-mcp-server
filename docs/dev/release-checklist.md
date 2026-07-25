# Release checklist — Server

The manual, interactive gate CI can't cover. **Copy this file per release** and tick each box
as you run it. CI covers the build, format/lint, unit tests, the structural catalogue, and the
cross-version behavioral matrix; this sheet covers connection stability, security-boundary
probing, cross-subsystem flows, dispatch integration, and the supply-chain audit that need a
running editor, a live client, or a fresh dependency scan.

Every check is runnable from a clone of this repo. Where a `Plan/…` path is cited it is the
**full methodology in the planning repo** — a secondary reference; the one-liners here are
self-contained. Most sections need a Godot editor running with the toolkit plugin enabled
(listening on port 6550) and the server built (`npm run build`).

---

## 1. Connection stability (B1–B8) — BLOCKING

Transport-layer behavior under adverse conditions — the failure modes most likely to frustrate
real users. Full methodology: `Plan/ExecutionPlan/41o-stability-sanity-check.md` → Part B
(planning repo).

- [ ] **B1 — Rapid connect/disconnect.** Connect, `Ctrl+C` the server, restart, reconnect —
      5 cycles fast. Each cycle clean; no leaked peers, no crash; dock shows correct status.
- [ ] **B2 — Disconnect mid-command.** Start a long tool call, kill the server mid-execution.
      Plugin cleans up the in-flight command and returns to listening; no orphaned state.
- [ ] **B3 — Server crash recovery.** Hard-kill the server, wait 10 s, restart. Plugin
      reconnects via backoff; no stale-token errors; tool list refreshes.
- [ ] **B4 — Editor unfocused during connection.** Connect, minimize/unfocus the editor 30 s,
      re-focus. Connection alive, commands still work, no timeout (unfocused-throttle fix).
- [ ] **B5 — Multiple server attempts.** Start a second server against the same editor. Second
      gets a clear error (port-in-use or auth reject); the first connection is unaffected.
- [ ] **B6 — Plugin disable while connected.** Disable the plugin with a live connection.
      Server disconnects cleanly; plugin tears down without crash; re-enable restores it.
- [ ] **B7 — Editor close while connected.** Close the editor with a live connection. Server
      detects the disconnect; no hanging process; clean error message.
- [ ] **B8 — Editor hard-kill mid-mutation.** Start a mutation call (e.g. `scene_create_node`),
      `taskkill /F` the Godot process before the response arrives. Server detects the socket
      drop promptly (no indefinite hang); the client gets a clear "editor disconnected" error
      (not a raw socket error); on restart the project state is consistent (no half-created
      nodes).

---

## 2. Security boundaries (D1–D7) — BLOCKING

Verify the security model holds under deliberate probing. Full methodology:
`Plan/ExecutionPlan/41o-stability-sanity-check.md` → Part D (planning repo).

> **Automated coverage:** `npm run smoke:single -- --only 18,21` exercises the path-traversal,
> envelope-injection, and response-cap boundaries (D1/D6/D7). Run it first, then hand-probe the
> rest.

- [ ] **D1 — Path traversal.** `res://../../../etc/passwd` → FileGuard rejects, clear error.
- [ ] **D2 — Absolute path.** `C:\Windows\System32\cmd.exe` → FileGuard rejects.
- [ ] **D3 — `user://` without gate.** Rejected unless the tool is in the user-scope whitelist.
- [ ] **D4 — Read-only mode.** Start the server with `GODOT_MCP_READ_ONLY=1`; a mutating tool
      (e.g. `scene_create_node`) is absent from `tools/list`. It is never registered, so the MCP
      layer rejects a direct call before the toolkit sees it.
- [ ] **D5 — Invalid auth token.** Send a command with a wrong/expired token → rejected, no
      partial execution.
- [ ] **D6 — Envelope injection.** File content containing `<untrusted-` tags → scrubbed before
      wrapping, no tag-breakout.
- [ ] **D7 — Oversized request.** 10 MB payload → rejected or handled gracefully (not OOM).

---

## 3. Cross-subsystem flows — BEST-EFFORT

Exercise the seams between subsystems (scene/script/resource/gate/runtime roundtrips).

- [ ] `npm run flows`

---

## 4. Dispatch integration — BEST-EFFORT

Mutation serialization, read bypass, FIFO ordering, notification timing, cancellation, peer
disconnect, and scene-lease contention against a live editor. Needs the toolkit token (read it
from `user://addons/godot_mcp_toolkit/project_instance_<hash>/mcp_token`; port defaults to
6550):

- [ ] `GODOT_MCP_TOKEN=<token> npm run test:integration:dispatch`

---

## 5. Supply-chain audit — BLOCKING

- [ ] **Production surface (BLOCKING).** `npm run audit` (= `npm audit --omit=dev`).
      **Zero high/critical production advisories** is required to ship. Triage and document any
      dev-only / moderate advisories.
  ```bash
  npm run audit
  ```
- [ ] **Full-tree drift check on the latest npm.** Run a full `npm audit` (dev + prod) on the
      newest npm available. Watch the **allow-scripts WARNING surface**, not just advisory
      counts — a newer npm can flag install-script permissions the pinned npm didn't. This
      mirrors the scheduled *latest-npm* drift job in the release pipeline.
  ```bash
  npm -v          # record the npm version used
  npm audit       # full tree; note advisories AND any allow-scripts warnings
  ```
