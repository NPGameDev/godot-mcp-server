# Smoke Test Maintenance Protocol

> **Standing rule (41m-bis): new tools/params → update sweep + smoke + flows.**
> Three validation layers now share maintenance (see `CONTEXT.md` "Validation
> vocabulary", plan repo):
> - **Smoke** (`test/sections/`) — every tool in **isolation** (this file).
> - **Flow suite** (`test/flows/`) — **cross-tool, stateful** flows smoke can't
>   express (see "Flow suite maintenance" below + the Flow Suite section of
>   `SMOKE-COVERAGE-MANIFEST.md`).
> - **Sweep** (toolkit `Validations/`) — the LLM-driven layer; also **confirms
>   flow-suite failures** (stale script vs real regression).
>
> **Dedup rule:** a check observable from a **single tool call** → smoke; a check
> that needs **cross-tool state or a multi-step sequence** → the flow suite.
> Never duplicate an assertion across the two.

## Last Known Good SHA

The smoke suite currently covers all behavior up to and including:

**Server repo:** `e0c2426` (fix(server): crash-detection hardening — heartbeat, timeouts, error safety)
**Date:** 2026-05-16

When updating the smoke suite, run `git log --oneline <this SHA>..HEAD` to find commits that need new test coverage. After updating, bump this SHA to the latest commit included.

## When to update smoke tests

Update `test/sections/` whenever an iteration:

1. **Adds a new tool** — create a new section file or extend the most
   relevant existing section. Must include: happy path, at least one
   guard test, and parameter variations.
2. **Adds new parameters** — extend the relevant section with assertions
   for the new parameter, including edge cases.
3. **Changes error codes or messages** — update expected values in
   assertions. If the error was previously correct, add a REGRESSION
   comment noting the old behavior.
4. **Improves DX hints** — add a hint content assertion (substring match
   via `assertHint`) to preserve the improvement.
5. **Fixes a bug** — add a REGRESSION assertion that would catch the bug
   if reintroduced. Include both T: and S: commit SHAs for traceability.
6. **Renames a parameter** — update all test calls using the old name.
7. **Changes profile behavior** — update section 01 (catalogue)
   expected tool counts.
8. **Adds/removes tool groups** — update section 39 (discover_tools) if
   group naming or workflow changes.
9. **Changes reconnect/transport behavior** — update section 19 (reconnect)
   which uses a fake echo server to test drop+reconnect cycles.
10. **Changes crash detection or log caching** — update section 40
    (crash_detection) which tests post-game-stop log retrieval and
    COMPILATION_FAILED detection.
11. **Adds or calls a version-gated tool** (one with `godotMinVersion` /
    `godotMaxVersion`) — guard every call with `bridge.getGodotVersion()` +
    `isVersionAtLeast(...)` so the suite runs to completion on every supported
    version. An unregistered tool returns JSON-RPC `-32601`, which `bridge.call`
    **throws**; the harness isolates a thrown section (fail-and-continue,
    41m-ter A0), but guard anyway to avoid false failures. `scene_close` (4.5+)
    is the example (sections 04/08/14 all gate on `godotVer >= 4.5`). For
    version-divergent node *types*, use the centralized helper
    (`tilemapNodeClass()` — TileMapLayer 4.3+ / legacy TileMap 4.2) rather than
    inlining the branch.

## Section naming convention

`NN_descriptive_name.ts` where NN is the next available number (currently 01–44).

## Running specific sections

Use `--only N,M,O` to run targeted sections during development:
```bash
npm run smoke:single -- --only 2,10,14
```

Full smoke (`npm run smoke`) is required at milestone gates.

## Assertion helpers

Located in `test/helpers.ts`:

| Helper | Purpose |
|--------|---------|
| `assertGuard(ctx, label, result, code, mustInclude)` | Verify `{success:false, code, error}` with substring checks |
| `assertHint(ctx, label, result, mustInclude?)` | Verify hint field (or error string fallback) contains expected substring |
| `assertError(ctx, label, result, code)` | Verify error envelope shape |
| `unwrapUntrusted(value)` | Strip `<untrusted>` security envelope |
| `probePort(host, port, timeout)` | TCP connection test |
| `makeFakeEchoServer()` | Fake WebSocket server for reconnect tests |
| `deepEqual(a, b)` | Deep structural equality |

## REGRESSION assertion format

```typescript
// REGRESSION: [description] (fixed T:[toolkit-sha] / S:[server-sha])
// [what broke and what the assertion verifies]
assertGuard(ctx, "REGRESSION description", result, "CODE", "substring");
```

Both T: and S: SHAs are included for cross-repo traceability.

## Coverage manifest

After any smoke update, update `test/SMOKE-COVERAGE-MANIFEST.md`:
- Add new tools with their section numbers
- Update coverage depth columns
- Bump the server commit SHA
- Mark any new gaps identified

## Section ordering rules

- Section 01 (catalogue) auto-includes when section 11 is selected
  (it provides the `ncmGated` flag).
- Section 19 (reconnect) always runs LAST — it drops the WebSocket
  connection. The filter logic moves it to the end regardless of
  declared position.
- Section 39 (discover_tools) activates and resets groups — run after
  functional sections to avoid namespace pollution.
- Section 40 (crash_detection) starts/stops games — run second-to-last
  to avoid disrupting other test state.

## Adding new sections

1. Create `test/sections/NN_descriptive_name.ts`
2. Export a `run` function: `export async function testName(ctx: TestCtx): Promise<void>`
3. Import and register in `test/smoke.ts`:
   - Add `import * as secNN from "./sections/NN_descriptive_name.js";`
   - Add entry to `ALL_SECTIONS` array
4. Include per-section cleanup (try/catch + `/* noop */` pattern)
5. Update `test/SMOKE-COVERAGE-MANIFEST.md`
6. Run `npm run format` before committing

## Pre-commit checklist

Before committing smoke test changes:
1. `npm run build` (TypeScript compilation)
2. `npm run smoke` (full suite — requires Godot editor running)
3. `npm run format` (Prettier formatting)
4. Verify no leftover probe files in the toolkit repo (check `git status` there)

---

## Flow suite maintenance (`test/flows/`, added 41m-bis)

The flow suite is the **deterministic cross-tool layer**. It shares this suite's
infrastructure but runs as its own command.

**Shared harness.** Orchestrator scaffolding (port-probe, ctx build, section
loop, counters, summary, exit codes, flag parsing, project-path discovery) lives
in `test/harness.ts` and is consumed by **both** `smoke.ts` and `flows.ts`.
Assertion helpers + `TestCtx` come from `test/helpers.ts`. The flow suite does
**not** use the dispatch raw-WS helpers (`test/integration/dispatch/helpers.ts`)
— those bypass the bridge to watch `_queued`/`_executing`; flows are tool-level.

**When to update flows.** When an iteration changes a **cross-tool or stateful**
behaviour:
1. Extension discovery / hot-reload / lifecycle → `flows/01_extension_lifecycle.ts`.
2. Live-instance method reachability after a script edit → `flows/02_hot_reload_reachability.ts`.
3. Multi-tool workflows where state carries across tools (signal persistence,
   node pipelines, save/reopen round-trips) → `flows/03_combo_chains.ts`.

Single-call checks stay in smoke (dedup rule above).

**Running.** `npm run flows` / `npm run flows:single -- --only N`. Editor
required. **No CI mode** (decision #8): the flow suite is local-only — same tier
as full smoke + dispatch integration. The deterministic+version-gated payload
feeds forward to `41n-quater`'s cross-version matrix (which runs real editors).

**Probe hygiene.** Flows write real files under `res://flow_probes/` in the
dogfood project (same as smoke's `res://smoke_*` probes). Every flow is
self-cleaning (try/finally) and the orchestrator does a final recursive
`folder.delete`. **Verify `git status` in the toolkit repo is clean after a run**
— no leftover `flow_*` probes.

**LLM-confirm (report-only / manual).** A flow FAILURE is NOT auto-classified.
Hand the failing flow/step to a **targeted LLM sweep re-run** (toolkit
`Validations/tool-sweep.md`) to tell a stale script from a real regression. No
auto-invocation from the `.ts` harness.

**Flow-suite pre-commit:** `npm run build` → `npm run flows` (editor up) →
`npm run format` → confirm clean toolkit `git status`.
