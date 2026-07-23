# Companion-Skill Efficiency

The toolkit ships a bundled agent skill — **`godot-mcp-toolkit`**, the workflow skill — that codifies tool-selection, batching, workflow, error-recovery, and token-efficiency patterns for an MCP-connected agent. This page reports what installing that one skill measurably did in a controlled build. It measures **only** the `godot-mcp-toolkit` workflow skill; it is unrelated to the `mcp-extension-creator` extension-authoring skill and to the npm bridge (the "companion" server package).

> **Indicative snapshot — measured 2026-07-21 at toolkit `305695b` / server `9325bc8`, on one 2D game with one model (n=3 runs/arm). A different game or model may show a different magnitude (the direction has been consistent). These numbers are re-measured periodically, not auto-generated, and we are actively driving them down for both arms — with and without the skill — as the toolkit gets leaner.**

## What was measured

The same game was built at **one HEAD** across two waves of three runs each: **Wave 1** with no skill installed, **Wave 2** with the `godot-mcp-toolkit` workflow skill installed (`skill=companion@1.0.0`). Measuring both waves at the same toolkit/server SHA isolates the skill's effect from any surface change. The skill delta is **Wave 2 − Wave 1**, compared on the **median** of the three runs in each arm.

**Scope.** Stellar Siege · Claude Sonnet 5 · n=3 runs/arm · Godot 4.5-stable · toolkit `305695b` / server `9325bc8` · 2026-07-21.

## The delta (median across 3 runs/arm)

| Metric (median) | No skill (Wave 1) | With skill (Wave 2) | Δ |
|---|---|---|---|
| Total tool calls | 382 | 327 | **−55** |
| Output tokens | 121,336 | 98,854 | **−22,482 (≈ −18.5%)** |
| Wall-clock | 27 min | 19 min | **−8 min** |
| Cost (USD) | $15.30 | $11.08 | **−$4.22** |
| Wasted calls | 44 | 36 | −8 |
| Tokens / requirement | 8,667 | 7,061 | −1,606 |

Medians summarize three runs per arm; the per-run spread is real. The underlying leg values:

| Metric | Wave 1 legs (1 / 2 / 3) | Wave 2 legs (1 / 2 / 3) |
|---|---|---|
| Total tool calls | 296 / 400 / 382 | 328 / 327 / 300 |
| Output tokens | 109,042 / 121,336 / 134,349 | 98,854 / 112,182 / 93,236 |
| Wall-clock (min) | 21 / 28 / 27 | 19 / 22 / 19 |
| Cost (USD) | 9.04 / 15.30 / 17.39 | 11.08 / 13.88 / 10.00 |
| Wasted calls | 24 / 69 / 44 | 33 / 54 / 36 |
| Tokens / requirement | 7,789 / 8,667 / 9,596 | 7,061 / 8,013 / 6,660 |

We report medians and the ranges above — no run is cherry-picked.

## Honest caveats

- **Two metrics moved slightly the wrong way, both within noise.** The confusion ratio (wasted ÷ total calls) rose +0.005 and the peak simultaneously-loaded tool count rose +2. Both are ≤ 0.12× the standard deviation of the leg-to-leg noise — the leg distributions almost entirely overlap, so there is no basis to read either as a regression. Every other metric moved in the expected direction.
- **Completeness held.** Both arms completed and playtested the full build in every run; the skill lowered the cost of getting there rather than trading away scope.
- **This is a single game, single model, n=3.** It is an indicative snapshot, not a guarantee. Treat the **direction** as the durable claim and the **magnitude** as specific to this build.

## A different kind of efficiency number

This page measures a *behavioral* result — how a real agent's run got cheaper with the skill installed — which depends on the game and the model, so it is a dated, re-measured snapshot. That is different from the toolkit's *structural* cost. For the deterministic, exactly-reproducible number — how many context-window tokens the tool catalogue itself consumes — see [token efficiency](token-efficiency.md). The two are complementary: one is what the surface costs to register, the other is what a build costs to run.
