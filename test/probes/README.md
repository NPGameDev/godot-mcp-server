# Probes

Hand-run diagnostic and verification scripts. Unlike the smoke and flow suites, these are
not part of any automated run: each one exists to answer a question the suites cannot, either
because it needs a human observing the editor, because it drives the wire directly instead of
going through the server, or because it reproduces a fault deliberately.

They are kept because the numbers they print back a decision. When a release checklist item
asks for evidence, the probe that produced that evidence lives here so the next release can
reproduce it instead of re-deriving the method.

Run them from the server repo root with the local tsx (never bare `npx`):

```bash
node_modules/.bin/tsx test/probes/<file>
```

Most need a running Godot editor with the toolkit plugin active. The wire-level probes also
need the session token, read from the toolkit's per-project data folder, and honour
`GODOT_MCP_EDITOR_PORT` (default 6550).

## Release-checklist probes

These map to items in `docs/dev/release-checklist.md`. Each file's header comment states its
exact assertions and how to invoke it.

| Probe | Checklist items | What it establishes |
| --- | --- | --- |
| `connection-stability-driver.ts` | §1 B1-B8 | Connection stability across reconnect cycles, a kill mid-call, a restart storm, a long idle hold, a second concurrent client, and an editor killed with mutations queued. Co-driven: the driver prints observable facts, the operator confirms them against the dock and console. |
| `path-guard-and-auth-probe.ts` | §2 D2, D3, D5 | The filesystem guard and auth layer as the *plugin* sees them: an absolute OS path, a `user://` path on a tool that does not allow it, and an invalid session token. Talks the raw WebSocket wire so no server-side response shaping is in the way. |
| `read-only-surface-probe.ts` | §2 D4 | Read-only mode really removes the mutating surface: spawns the built server twice, once with `GODOT_MCP_READ_ONLY=1`, diffs both `tools/list` responses, and confirms a direct call to an unregistered mutating tool is rejected before the toolkit sees it. |
| `oversize-request-probe.ts` | §2 D5c, D7 | An oversized inbound request is handled gracefully and the editor survives it, plus the positive control that keeps the "no leaked node" assertion in `path-guard-and-auth-probe.ts` from passing vacuously. |

## Diagnostic probes

| Probe | Use it when |
| --- | --- |
| `lsp-raw-probe.mts` | An LSP tool reports nothing and you need a byte-accurate view of the wire to tell whether the editor is publishing at all. |
| `lsp-scan-probe.mts` | Same question one layer up: the real handler plus the raw payload it received. Note that a local LSP run needs `GODOT_MCP_PROJECT_PATH` set, or the scan silently walks the wrong tree. |
| `screenshot-oversize-disk-probe.ts` | Verifying that an over-budget screenshot falls back to the disk path instead of overflowing the transport. |
