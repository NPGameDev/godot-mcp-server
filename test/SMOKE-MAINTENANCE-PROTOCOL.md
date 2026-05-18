# Smoke Test Maintenance Protocol

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
7. **Changes profile/gate behavior** — update section 01 (catalogue)
   expected tool counts and gate membership.
8. **Adds/removes tool groups** — update the dual-pass group lists in
   `run-smoke.ts` (they import from `feature_gate.ts` automatically).
   Update section 39 (discover_tools) if group naming or workflow changes.
9. **Changes reconnect/transport behavior** — update section 19 (reconnect)
   which uses a fake echo server to test drop+reconnect cycles.
10. **Changes crash detection or log caching** — update section 40
    (crash_detection) which tests post-game-stop log retrieval and
    COMPILATION_FAILED detection.

## Section naming convention

`NN_descriptive_name.ts` where NN is the next available number (currently 01–43).

## Running specific sections

Use `--only N,M,O` to run targeted sections during development:
```bash
npm run smoke:single -- --only 2,10,14
```

Full dual-pass (`npm run smoke`) is required at milestone gates.

## Dual-pass design

The smoke suite runs twice per `npm run smoke`:

- **Pass 1 (gates OFF):** Only eagerly-registered tools are available.
  Gated sections (input_map, execute_code, save, etc.) detect the gate
  and skip gracefully. Regression tests for gated tools also skip in
  this pass — they live inside their functional section which handles
  the gate check.

- **Pass 2 (gates ON, `--gates-on-skip`):** All feature gates enabled
  via env vars. Only sections that export `isAffectedByGates = true`
  run — non-gate-affected sections are skipped with a SKIP log line.
  This cuts the gates-on pass from ~43 to ~6 sections. The
  over-activation warning in section 40 fires because many groups get
  loaded.

A regression that only manifests with gates ON would be missed by a
single-pass run. Always use `npm run smoke` (not `smoke:single`) for
final validation.

## `isAffectedByGates` export

If your new section tests behavior that differs when feature gates are
on vs off, add near the top of the section file:

```typescript
export const isAffectedByGates = true;
```

This ensures the section runs in the gates-on pass when `--gates-on-skip`
is active. Sections without this export are skipped in pass 2. If you
forget the export but your section checks `featureEnabled()`, the section
still runs in pass 1 (gates off) — the only miss is the gates-on re-run.

Currently gate-affected sections: **01, 11, 12, 13, 18, 21**.

## Gate-check pattern for gated sections

When a section tests a gated tool, use the early-return pattern:
```typescript
const result = await bridge.call("tool_name", params, CALL_TIMEOUT);
const isGated = result?.code === "FEATURE_DISABLED";
if (isGated) {
  pass("tool_name -> FEATURE_DISABLED (skipping functional tests)");
  return;
}
// ...functional tests follow
```

Regressions for gated tools go INSIDE the section after the gate check,
so they naturally skip in pass 1.

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
- Section 02 (gate_enforcement) validates all feature gates are blocked
  when disabled. No `isAffectedByGates` export — runs in pass 1 only.
- Section 20 (reconnect) always runs LAST — it drops the WebSocket
  connection. The filter logic moves it to the end regardless of
  declared position.
- Section 40 (discover_tools) activates and resets groups — run after
  functional sections to avoid namespace pollution.
- Section 41 (crash_detection) starts/stops games — run second-to-last
  to avoid disrupting other test state.

## Adding new sections

1. Create `test/sections/NN_descriptive_name.ts`
2. Export a `run` function: `export async function testName(ctx: TestCtx): Promise<void>`
3. If the section tests gate-dependent behavior, add:
   `export const isAffectedByGates = true;`
4. Import and register in `test/smoke.ts`:
   - Add `import * as secNN from "./sections/NN_descriptive_name.js";`
   - Add entry to `ALL_SECTIONS` array (include `gateAffected` if applicable)
5. Include per-section cleanup (try/catch + `/* noop */` pattern)
6. Update `test/SMOKE-COVERAGE-MANIFEST.md`
7. Run `npm run format` before committing

## Pre-commit checklist

Before committing smoke test changes:
1. `npm run build` (TypeScript compilation)
2. `npm run smoke` (full dual-pass — requires Godot editor running)
3. `npm run format` (Prettier formatting)
4. Verify no leftover probe files in the toolkit repo (check `git status` there)
