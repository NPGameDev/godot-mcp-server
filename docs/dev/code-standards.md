# Code Standards — Server

The code standard for `godot-mcp-server`, the npm-published TypeScript MCP-bridge half of the
project. It does **not** govern the GDScript toolkit — that repo carries its own standard. Every
convention here is idiomatic TypeScript / Node: the server does not inherit the toolkit's GDScript
conventions, and mixing the two is a defect, not consistency.

The document has two parts, and the split is load-bearing:

- **Part I — Portable core** is project-agnostic. It is the set of TypeScript and Node conventions
  that hold for *any* MCP server or Node service, written so it can be lifted into a new project
  as-is. It names this repo's companion documents (a glossary, a contract doc) only as *optional*
  alignment points, never as prerequisites.
- **Part II — Project bindings** is this repo's specifics: the Bridge (the stdio↔WebSocket reference
  implementation), the `ErrorCode` cross-repo contract, the MCP-SDK surface rules, the deterministic-
  JSON discipline, the `src/` module taxonomy, the canonical in-tree exemplars, and the contract
  bindings.

**Scope of the general rules.** The general clean-code rules in Part I — naming, formatting, static
typing, comments, design, and async discipline — apply to **all TypeScript in the codebase**: the
shipped `src/`, the `test/` trees, and any tooling script. A file being a test or a one-off script
does not lower its readability bar. The genuinely **server-specific** rules — the MCP/SDK surface,
the error-classification contract, the deterministic-JSON discipline, the contract-surface recipes,
and npm shipping — are **Part II bindings**: they touch the bridge and the protocol seam, not every
file, but where they apply they are not optional.

**On conflict, the hard gates win.** A few rules are **hard-line** and override stylistic preference
wherever the two collide, because each is driven by a concrete failure mode, not taste:

- **stdout is the stdio transport** — a stray `console.log` to stdout corrupts the JSON-RPC stream
  ([B2](#b2-mcp--sdk-surface-discipline)).
- **Never swallow or relabel an error across the bridge** — a flattened transport code breaks the
  client's retry-vs-give-up decision ([B3](#b3-error-classification--the-errorcode-cross-repo-contract)).
- **Contract-surface recipes match the toolkit exactly** — a drifted hash / token-path / framing /
  port recipe breaks the cross-repo handshake silently ([B5](#b5-contract-surface-fidelity--cross-version-caveats)).
- **Never block the single-threaded event loop** — a synchronous spin or sleep freezes *every*
  in-flight call, not just the caller ([§7](#7-async-promises-and-the-event-loop)).

Each is flagged **hard-line** at its site.

Primary references:

- TypeScript Coding Guidelines (the TypeScript team's own conventions) —
  <https://github.com/microsoft/TypeScript/wiki/Coding-guidelines>. Adopted as the touchstone for
  "idiomatic TypeScript": its **naming, type, and structural** conventions (PascalCase types with no
  `I-` prefix, camelCase functions/vars/properties, no `_` private prefix, shared types in one
  module, type-before-value). Two deliberate non-adoptions: its **hand-formatting** rules are
  superseded by Prettier ([§3](#3-formatting)), and its **compiler-codebase specifics**
  (diagnostic-code ranges, `ts.forEach` over `for..in`, no-new-files) are N/A to an application
  server — take the language conventions, not the compiler-repo rules.
- TSDoc — <https://tsdoc.org> (the doc-comment vocabulary, [§5](#5-comments-and-documentation)).
- Prettier — <https://prettier.io> (the enforced formatter, [§3](#3-formatting)).
- Model Context Protocol — <https://modelcontextprotocol.io> (the SDK + wire protocol,
  [B2](#b2-mcp--sdk-surface-discipline)).

---

# Part I — Portable core

## 1. File, folder, and symbol naming

1.1 **Group `src/` by bounded context, not by technical layer.** Source lives in feature/domain
folders; the **main actor sits at the domain-folder root** and its single-responsibility
collaborators in subdomain child folders. **Shared / cross-cutting modules** (types, errors, version,
schema + error shaping) live in a peer `shared/` folder, never nested under one feature owner. The
`bin` entry and the multi-instance registry stay at the `src/` root. *Rationale: a bounded-context
boundary that is invisible in a flat root becomes self-evident as a folder.* *(The realized folder
set is [B7](#b7-module-taxonomy--the-composition-root).)*

1.2 **Source files are `camelCase.ts`** — the idiomatic TypeScript file convention (the TypeScript
compiler's own source uses it: `moduleNameResolver.ts`, `commandLineParser.ts`), matching the
codebase's camelCase symbol naming. Single-word files stay lowercase (`bridge.ts`, `errors.ts`,
`types.ts`); multi-word files are camelCase (`toolRegistry.ts`, `stableJson.ts`, `configReload.ts`,
`pathGuard.ts`, `lspClient.ts`, `groupState.ts`). One module = one file.

1.3 **Identifier casing:**

| Kind | Case | Example |
|---|---|---|
| functions / vars / params | `camelCase` | `callAndWrap`, `registerToolWrapped` |
| types / interfaces / classes | `PascalCase` | `BridgeError`, `AuthResponse`, `ToolDef` |
| module-const tunables | `UPPER_SNAKE_CASE` | `RECONNECT_BASE_MS` |
| error-code members (the `ErrorCode` union) | `UPPER_SNAKE_CASE` | `CONNECT_FAILED`, `TIMEOUT` |

1.4 **Module privacy is via non-export — no `_` prefix.** Privacy is expressed by **not exporting**
the symbol (the primary mechanism), never by a name decoration: per the TypeScript Coding Guidelines,
do not use a leading `_` as a prefix for private properties / identifiers. A module-private singleton
takes a plain camelCase name (`lspClient`, not `_lspClient`). The linter's `_`-prefix escape hatch
for **intentionally-unused** params/vars ([§4](#4-static-typing), the `no-unused-vars` override) is a
**distinct** mechanism — it marks "deliberately unused," not "private" — and stays.

1.5 **ESM import discipline.** `"type": "module"` ⇒ **every relative import ends in `.js`** (the
compiled-output spec): `import { x } from "./errors.js"`. Use `import type { … }` for type-only
imports to keep types out of the runtime graph. Namespace imports for a uniform module family
(`import * as scene from "../tools/scene.js"`). No `require` — ESM only.

1.6 **Names are intent-revealing and unambiguous** — no unexplained abbreviations; the name states
the role (`registerToolWrapped` says *what* wrapping happens; `toolErrorFromException` says *the
source*). Grab-bag tokens (`utils`, `helpers`, `manager`) are allowed only with a domain qualifier
that says *which* domain, never alone. *If the project maintains a glossary, align every public name
to its canonical term.*

1.7 **MCP tool param naming — path params.** A tool that takes a **single** filesystem/resource path
names that param **`file_path`** (not bare `path`, not a domain-specific alias). A tool that takes
**both an input and an output path** names them **`source_path`** and **`dest_path`** (the
source→destination pair, per `asset_import`) — the two-path exception. Do NOT "correct" a genuine
two-path tool down to a single `file_path`: `file_path` on a source/dest tool is ambiguous ("from or
into?"). Node-tree paths (a node's path within the edited scene) are **`node_path`** / `parent_path`,
distinct from filesystem paths. Result pages follow the pagination envelope (`returned` / `total_<unit>` /
`has_more`; B5.x).

---

## 2. Module structure and declaration order

2.1 **Declaration order within a file:** imports (type-imports grouped) → module constants →
exported types/interfaces → exported functions → file-private helpers. Section banners
(`// ── Title ──`) may separate concerns in a longer module — **but a high banner count is itself a
split signal** ([§6](#6-design-solid-cohesion-and-decomposition)).

2.2 **A composition root owns sequencing, not domain logic.** The `bin` entry constructs and wires —
bridge, server, hook pipeline, tool/group/prompt/resource/root registration, transport connect — and
owns the **boot order**; the domain logic lives in the collaborators it composes. The ordering is
load-bearing: preflight gates may exit the process before any socket opens; the transport connects
only after the full tool surface is registered. Keep the root thin
([§6](#6-design-solid-cohesion-and-decomposition)). *(The realized root is
[B7](#b7-module-taxonomy--the-composition-root).)*

---

## 3. Formatting

Formatting is **machine-owned and never hand-applied** — an enforced Prettier config is the single
authority, and the linter defers to it (`eslint-config-prettier`). This is the deliberate supersession
of the TypeScript Coding Guidelines' hand-formatting rules: an automated, CI-gated formatter replaces
that whole layer, so reflowing by hand only fights the tool. Fix violations through the project's
format-fix script, never a bare formatter invocation.

3.1 The enforced config: **120**-column print width · **2**-space indent (no tabs) · semicolons ·
**double** quotes · trailing commas everywhere · always-parenthesized arrow params · LF line endings.
Build output, `node_modules`, and Markdown are ignored. CI gates on the format check.

---

## 4. Static typing

The compiler and linter are the **enforced baseline** — the equivalence net a dynamically-typed
language lacks:

- **`strict: true`** — the full strict family (`noImplicitAny`, `strictNullChecks`,
  `strictFunctionTypes`, `useUnknownInCatchVariables`, …). The **floor**.
- **`noUnusedLocals` / `noUnusedParameters`** — dead locals/params are **compile errors** (escape
  hatch: `_`-prefix, also honored by the linter's unused-vars override).
- **`noEmitOnError: true`** — build output is **not produced** if the typecheck fails ⇒ the build *is*
  the typecheck gate.
- **`no-explicit-any` = error** — `any` is effectively banned (§4.1).
- `target` / `module` `ES2022`, `moduleResolution: "Bundler"`.

The **human-judgment layer** the linter can't enforce:

4.1 **Prefer `unknown` + narrowing; `any` requires a justified escape hatch.** Boundary values are
typed `unknown` and narrowed via `typeof` / `instanceof` / property probes before use. Catch clauses
use `err: unknown`, then narrow (`err instanceof BridgeError`). The **only** sanctioned `any` is an
inline `// eslint-disable-next-line @typescript-eslint/no-explicit-any` **with a one-line
justification** of why the type is genuinely unrepresentable to the checker (an SDK overload shape, a
third-party-schema internal). Do not add one without that justification.

4.2 **`interface` for extensible object contracts; `type` for unions / aliases / function types.**

4.3 **`const` by default; `let` only for genuinely-reassigned bindings** (a reconnect state machine,
a running accumulator). `readonly` on array fields in public contracts
(`pathParams?: readonly PathGuard[]`).

4.4 **Every exported function/method declares an explicit return type** (`: ToolTextResult`,
`: Promise<ToolTextResult>`, `: string | undefined`). Inference is fine for locals.

4.5 **No `as` for validation** — narrow with runtime checks, not assertions; `as` is for
genuinely-unrepresentable-to-the-checker cases only.

4.6 **Prefer `undefined` over `null`** (TypeScript Coding Guidelines: *"Use `undefined`. Do not use
`null`."*). Internal optionals and "not found" / "none" sentinels use `undefined` or a plain optional
`?` (`getGodotVersion(): GodotVer | undefined`). Keep `null` **only** at an external boundary that
mandates it:

- a **JSON wire value** — a field `JSON.parse`'d from the toolkit, or a literal `null` an **outbound**
  response / notification payload must carry (`JSON.stringify` **drops** `undefined` keys but **keeps**
  `null`); or
- a **library / SDK contract** that returns or requires `null` (JSON-RPC `id` / `params`, the
  replacer slot in `JSON.stringify(x, null, 2)`, LSP result types).

The loose `x == null` (matches both) is the idiomatic nullish guard; a **strict** `=== null` is
correct only against a value deliberately kept `null`.

---

## 5. Comments and documentation

Comments split into two tiers: **doc comments** (`/** … */`) a generator harvests into the published
API reference and an editor surfaces on hover, and **ordinary comments** (`//`) for implementation
notes. The general philosophy below governs both; [§5.11](#511-the-typescript--tsdoc-doc-comment-layer)
adds the TypeScript / TSDoc specifics on top.

Each rule carries a confidence flag distilled from the canonical literature and the major adopted
style guides: **[STRONG]** = near-universal · **[common]** = widely held · **[contested]** =
guidance, not law.

### 5.1 Core principle — intent (the "why"), never history

Code already says *what* it does and *how*; a comment earns its place by saying *why* — the
rationale, the non-obvious constraint, the hazard, the contract a reader can't infer. Two corollaries:

1. **Why, not what/how.** A comment that restates the next line earns nothing and rots into a lie.
   Comment the *surprising*, not the *obvious*. [STRONG]
2. **Intent, not history.** A comment is self-contained intent for the reader of *this* code, not a
   development log. When it changed, which ticket or iteration produced it, who debated it — that
   belongs in version control, commit messages, and decision records. The comment carries the
   *resulting* intent, rewritten so it stands alone. [STRONG]

```
// ✗ retry 3 times
// ✓ retry 3×: the upstream load-balancer drops the first request after an idle period
```

### 5.2 What a comment is for (the high-value categories)

Write a comment when — and largely only when — it does one of these:

- **Intent / rationale** — *why* this approach, and why the obvious alternatives were rejected. The
  most durable category; structurally unrecoverable from code. [STRONG]
- **Warning of consequences** — hazards the code can't enforce (`// not safe to call after connect`;
  `// O(n²); fine for the fixed catalogue, never on user data`). Often the highest-value comment in a
  file. [STRONG]
- **Amplification** — flag a detail that looks trivial or removable but isn't, so a future "cleanup"
  doesn't reintroduce a bug (`// the trailing trim is required — the protocol appends a NUL byte`).
  [common]
- **Clarification of the unidiomatic** — explain a deliberate workaround or perf trick so it isn't
  "simplified" away. [common]
- **Invariants, assumptions, preconditions** — correctness conditions the syntax can't express.
  [STRONG]
- **Precision the type can't give** — units, value ranges, null/empty semantics, inclusive vs
  exclusive boundaries (`// timeout in milliseconds; 0 disables (not "instant")`). [STRONG]
- **A stable external reference** — a public issue/bug/PR link, a spec, an RFC, when the authoritative
  rationale lives outside the repo. Phrase it as *intent + constraint*, not narration
  ([§5.4](#54-intent-not-development-history)). [common]

### 5.3 Express intent in the code first

The cheapest, most reliable comment is the one the code made unnecessary.

- **Prefer self-explanatory code over a comment.** A well-named `isOverdue()` beats
  `// check if overdue`; names and types are compiler-checked and never drift. [STRONG]
- **A comment needed to explain confusing code is a smell — refactor first.** If a block needs a
  paragraph to be understood, the fix is usually extraction or a better name. "Don't comment bad code
  — rewrite it." [STRONG]
- **"Self-documenting code" is the goal, not a licence to omit the *why*.** Names and structure carry
  *what/how*; they cannot carry rationale, rejected alternatives, or hazards. The consensus is quality
  over quantity. [contested]
- **Comment at a different level of abstraction than the code** — go *lower* (precision) or *higher*
  (intent); a same-level comment just echoes the code. [STRONG]

### 5.4 Intent, not development history

Comments are read by strangers reading *this* code; they are not a changelog. This is the core
principle's sharpest edge.

- **Keep process history out of source.** No edit journals, no "changed by … on …", no
  sprint/iteration/ticket narration, no "we decided this during review." Version control records
  who/when/what far better, and the in-source log only rots. Rewrite the *resulting* intent inline;
  relocate the narrative rationale to commit messages and decision records
  ([§5.10](#510-relocating-stripped-rationale)). [STRONG]

  ```
  // ✗ Added in sprint 14 (TICKET-882); reworked after the Apr review — see decision log #7
  // ✓ Serialised single-file to avoid the torn-write race when two writers share the path
  ```

- **Keep load-bearing external references — rephrased as intent + constraint.** A *public* bug/PR link
  or spec reference that explains why this code must exist (or must not be "simplified") stays at the
  site, written as intent. Test: would a contributor with *only this repository* understand the why?
  If a reference is private or unreachable, inline enough context to stand alone, or drop it. [common]

  ```
  // ✓ work around <upstream/repo#1234>: the API returns stale data until the next frame, so re-read
  ```

- **No attribution or authorship tags** (`@author`, "created by") — version history owns that, and the
  tag is stale the moment someone else edits. [common]

### 5.5 Documenting the public surface

- **Document every public / exported symbol** — module, type, exported function, public field/enum.
  Public doc comments feed the generated reference and onboard contributors. [STRONG]
- **A doc comment must let a caller use the item without reading its body** — purpose, parameters,
  return, and failure modes. **Document cross-module contracts where they're defined** (return shapes,
  invariants); they are the de-facto API between modules. [STRONG]
- **Document intent and contract, never types.** The signature already carries the types; repeating
  them is pure redundancy. Describe *meaning, units, contract*. [STRONG]
- **Lead with a one-line summary; defer depth** into the detail slot. [STRONG]
- **Give non-obvious public APIs a runnable example** — the fastest contract a user reads. Favour
  *clear* over *realistic*. [common]
- **Cross-reference instead of duplicating** — link a related symbol rather than re-describing it; one
  fact, one home. [STRONG]
- **Mark deprecations with the dedicated tag and name the replacement.** [common]
- **Internal/private comments are need-based, not mandatory.** Keep implementation detail out of the
  public docs. [STRONG]
- **Where the ecosystem supports it, make the public-API-doc requirement machine-enforced** so docs
  don't drift as the API grows. [common]

### 5.6 Anti-patterns (delete on sight)

- **Redundant / parrot comments** that restate the code (`i += 1  // add one`). Delete; rename the
  symbol if the intent was unclear. [STRONG]
- **Misleading / outdated comments ("rot")** — a stale comment is *worse than none*: the reader trusts
  it and builds on a false premise. [STRONG]
- **Commented-out / zombie code** — delete it; version control remembers. [STRONG]
- **Journal / changelog comments** in source → version control. [STRONG]
- **Noise / mumbling** — half-finished thoughts, decorative filler. Resolve or cut. [STRONG]
- **Banner / position-marker overuse** — heavy dividers usually signal the unit does too much (extract
  instead). If used at all, one agreed format, no ASCII-art boxes. [common]
- **Closing-brace / block-end comments** (`} // end if`) — a crutch for over-long blocks; extract a
  function. [STRONG]
- **Over-commenting trivial code** — dilutes the rare comment that matters. [STRONG]
- **Apology / excuse comments** ("ugly hack, no time") — fix it or file a tracked issue and reference
  it. [common]
- **Vague or imprecise comments** — if you can't say it clearly, don't. [STRONG]
- **Caller / consumer enumerations** — a comment listing *who calls* the unit (`Used by X and Y`,
  `Called by index.ts`). The roster rots the instant a caller is added or renamed, and it duplicates
  what a reference search answers authoritatively. State the unit's **role and contract**, not its
  callers. Keep a consumer reference only when it is *load-bearing context the caller can't otherwise
  know* — e.g. "the wrapper pre-filters path params, so this handler may assume a checked path" (a
  *constraint*, not a roster). [STRONG]

  ```
  // ✗ Used by toolRegistry.ts and extensionRegistrar.ts to filter version-gated tools
  // ✓ Engine-version comparison helpers for version-gated tool registration
  ```

### 5.7 TODO / FIXME and friends

- **Use a small, fixed, greppable marker set** with defined meanings (`TODO` = planned work, `FIXME` =
  known-broken, `HACK` = brittle). Keep the set short. [common]
- **Every marker is actionable + attributable + tracked** — state *what* and *why*, and reference a
  tracking issue where one exists: `TODO(<issue-or-owner>): <description>`. Track the real work in the
  issue tracker, not in source. No bare `TODO`. [STRONG on the marker]
- **Bind time/condition-dependent markers to a concrete trigger** ("remove when all clients send v2")
  — "someday" TODOs never resolve. [common]
- **Scan markers in CI** so orphans surface and get triaged. [common]

### 5.8 Open-source hygiene (comments are public)

- **Never put secrets in comments** — keys, tokens, passwords, private endpoints. Public repos are
  scanned by bots within minutes of a push. [STRONG]
- **No internal-only URLs, absolute developer paths, or unreachable names** — contributors can't use
  them and they leak internal topology. [common]
- **Make ticket references resolvable** — a public tracker, or inline enough context to stand alone.
  [common]
- **Use an SPDX `SPDX-License-Identifier:` header, not a full licence blurb per file** —
  machine-readable, travels with the file, no per-file drift; full text lives once in `LICENSE`.
  [STRONG for OSS]
- **Keep comments professional, inclusive, contributor-facing** — no profanity, snark, blame,
  in-jokes, or non-inclusive terms. [common]
- **Attribute and link copied/adapted code** for licence compliance and provenance. [common]

### 5.9 Keeping comments healthy

- **Update a comment in the same change as the code it describes** — atomically. The one discipline
  that prevents rot. [STRONG]
- **Co-locate a comment with its code** — a detached comment drifts. [STRONG]
- **Treat comment accuracy as a code-review gate** — review that comments are still true and carry
  *why* not *what*. When a reviewer can't follow the code, fix the *code* first. [common]
- **Prefer making the comment unnecessary (refactor-first).** [STRONG]
- **Doc comments are build artifacts, not decoration** — the reference generator consumes them and
  warns on malformed input; a stale or broken doc comment is a defect. [STRONG]
- **Delete dead comments on sight** — zombie code, obsolete TODOs, notes that no longer apply.
  [STRONG]

### 5.10 Relocating stripped rationale

When [§5.4](#54-intent-not-development-history) strips internal narrative rationale out of a comment,
relocate it — to the commit message or a decision record — rather than deleting the *thinking*. The
comment keeps only the self-contained *resulting* intent; the narrative trail lives where history
belongs. *The concrete decision trail for this repo is [B9](#b9-decision-trail--companions).*

### 5.11 The TypeScript / TSDoc doc-comment layer

The general rules above, plus what `/** … */` doc comments and the TSDoc vocabulary require on top.

5.11.1 **`/** … */` doc comments on exported symbols; `//` for implementation notes inside bodies.**
The block form feeds the generated reference and editor hover; the line form is for the *why* a reader
needs while editing.

5.11.2 **TSDoc block tags are valid — use them.** Unlike GDScript (which has no parameter/return
tags and documents in prose), TSDoc supports `@param`, `@returns`, `@throws`, `@example`, `@remarks`,
`@deprecated`, `@internal`, and the inline `{@link}`. Reach for them on the public surface.

5.11.3 **Document intent and contract, never types.** The TypeScript signature already carries the
types, so `@param` describes *meaning, units, contract* — never the type. A type-only doc tag is pure
redundancy.

```
// ✗ @param count  the number count
// ✓ @param count  items to take from the head; clamped to the buffer length
```

5.11.4 **Lead with a one-line summary; defer depth to `@remarks`.** The first line is the brief shown
in lists and tooltips; the body and `@remarks` carry the detail.

5.11.5 **Document the public seam, not every line.** Hold the **exported symbols reachable from a
subsystem's public seam** (its barrel / main module) to the exemplary bar: a **module-level header**
summarizing the subsystem; a per-symbol **one-line summary**; `@param` / `@returns` **only where they
add intent** (never restating the TS type, 5.11.3); `@remarks` / `@example` on the highest-traffic
surfaces. Non-seam modules still meet 5.1–5.10 (clear, intent-first comments) but are **not** held to
the exemplary bar — depth scales with reach.

5.11.6 **Cross-reference with `{@link}` instead of duplicating** — link the related symbol rather than
re-describing it; one fact, one home.

5.11.7 **`@internal` for a symbol exported only for a sibling module.** "Exported for a sibling" ≠ "in
the public reference" — tag it `@internal` and the generator prunes it (`--excludeInternal`).

5.11.8 **Standard TSDoc tags only** (`@param @returns @throws @remarks @example @internal
@deprecated`); no custom tags — the reference generator follows the TSDoc spec and a custom tag warns
or is dropped.

5.11.9 **The public surface is published as a generated reference.** Where the ecosystem supports it
(the server's is generated Markdown — toolchain binding in [B6](#b6-npm-distribution-tooling--shipping-hygiene)),
the doc comments above are the source; a stale or malformed doc comment is a build defect, not just a
style nit. Regenerate when canonical doc comments change.

---

## 6. Design: SOLID, cohesion, and decomposition

The grounding here is SOLID and Clean Code applied to TypeScript — most sharply the
**single-responsibility principle**, supported by cohesion, DRY, and command/query separation; the
remaining SOLID principles (open/closed, Liskov, interface-segregation, dependency-inversion) are the
background the same rules serve. Cohesion is a property of the **whole tree**: apply the *same*
decomposition pattern everywhere so a contributor recognises one shape in every subsystem.

6.1 **One statable responsibility per file (file-level SRP).** A module should have a single reason to
change. *Test:* describe the module or class in about 25 words with no "and", "if", "or" or "but"; if
you can't, it is a decomposition candidate. *Rationale: a file you can't spec in a sentence is
one a reader can't hold in their head.*

6.2 **Orchestrator + collaborators is the standard decomposition.** A thin **orchestrator** owns
**lifecycle, delegation, and wiring** — not domain logic; the single-responsibility **collaborators**
own the logic and export a **narrow** surface. The composition root ([§2.2](#2-module-structure-and-declaration-order))
is one orchestrator; a uniform per-module entry point (e.g. `register(server, bridge, allowed)`) is
another.

6.3 **When to split — guidance, not a hard line.** **Responsibility count, not line count, is the
metric.** A long *cohesive* module (one tool group, one serializer) is fine; banner-separated
*distinct* concerns and mixed abstraction levels are the real smell. Size alone never forces a split.
Size does trigger a check: a reviewer writes the one-sentence responsibility of each non-test file
over 500 lines that a change touches; a sentence that needs "and" marks it as a decomposition
candidate. The 500 lines is a prompt to look, not a ceiling, and there is no function-length limit.

6.4 **DRY — extract any shape or decision built ≥ 2×, with the rule-of-three caveat.** A single
failure-shape builder, a single serializer, a single try/catch→error→stringify wrapper beats the same
logic copied across call sites — a duplicated shape is a latent contract that drifts. **Caveat:**
incidental similarity *expected to diverge* is **not** duplication — prefer a little repetition over
the wrong abstraction. **A fix covers every site with the same defect,** and logic duplicated across
those sites moves into one module they all call: the copies drift, and the one a fix misses keeps
the bug.

```ts
// ✗ two handlers each fit the raw value to the property's declared type
function setProperty(raw: string, declared: string) {
  const value = declared === "int" ? Number.parseInt(raw, 10) : raw;
  // ...
}
function writeResource(raw: string, declared: string) {
  const value = declared === "int" ? Number(raw) : raw;
  // ...
}

// ✓ one fitter both handlers call, so each body becomes:
//   const value = fitToDeclaredType(raw, declared);
```

6.5 **CQS — a function mutates state OR returns data, not both.** A read folded into a mutating verb
hides the read from callers and the routing layer; extract it into its own read path.

6.6 **No import cycles; export discipline.** Keep a **leaf-type module** that names **no runtime
symbol** — runtime depends on it, never the reverse. **Module-private by default**: `export` is a
deliberate surface decision, not the default reflex.

6.7 **Uniformity, with documented exceptions.** Apply this section consistently so every subsystem
reads the same way. A deliberate deviation is allowed but must be **documented** — an inline comment
at the site, or a noted exception in this standard.

6.8 **Folder topology is the decomposition made visible — main actor at the domain-folder root,
sub-actors in subdomain child folders.** Group `src/` into **bounded-context domain folders**; inside
each, the **orchestrator sits at the folder root** and the **collaborators it composes live in child
folders, divided by subdomain** ([§1.1](#1-file-folder-and-symbol-naming)). This is the on-disk shape
of the 6.2 split — a reader opens one folder and finds the orchestrator beside what it wires. A
decomposition's children are **born in the right folder**, not created flat and relocated later.

---

## 7. Async, Promises, and the event loop

Node runs one thread. These rules keep that thread responsive and the process alive; the first is
**hard-line**. *(The Bridge is this repo's reference implementation —
[B1](#b1-the-bridge--the-transport-reference-implementation).)*

7.1 **Never block the single-threaded event loop with a synchronous spin or sleep — hard-line.** A
busy-wait (`while (Date.now() - start < delay) {}`) or any synchronous sleep freezes **every**
in-flight call, timer, and heartbeat for its full duration — not just the caller. Use `await`-able
I/O and real timers (`setTimeout`) for a delay, or drop the wait entirely when an atomic-write source
makes the retry unnecessary. *(This is the TypeScript analogue of the toolkit's no-blocking-delay-in-
handlers rule — same hazard, different runtime.)*

7.2 **No floating promises.** Every Promise is `await`-ed or explicitly `.catch`-ed; intentional
fire-and-forget is marked `void` (`void doThing().catch(() => {})`).

7.3 **The only sanctioned swallow is a commented fire-and-forget.** `catch {}` / `.catch(() => {})` is
allowed **only** for a deliberate fire-and-forget path and **must carry a comment** saying why the
failure is safe to drop. A silent, un-commented `catch` is a defect.

7.4 **Cancellation is first-class.** Long calls take an optional `AbortSignal`; a pre-aborted signal
throws the cancellation code immediately; an abort mid-flight clears the timer, rejects, and notifies
the peer cooperatively.

7.5 **Every pending call has a timeout** that rejects and deletes the pending entry. Progress signals
from the peer **reset** the timer so a slow-but-alive operation doesn't false-timeout.

7.6 **The process never dies on a stray rejection.** `unhandledRejection` and `uncaughtException`
handlers log to `stderr` and keep the service alive — a single dropped promise must not take down the
bridge.

---

## 8. Untrusted data at OS sinks (input validation)

Before handing a value that originates from untrusted or data-derived input (a downloaded catalog, a
client-supplied URL or path, anything crossing the wire) to an OS sink — a shell / `child_process` /
`exec` call, an `open`, or a filesystem operation outside the path guard — validate it: for a URL,
allowlist the scheme (`http` / `https`) and reject the rest (`file:`, `javascript:`, custom
handlers); for a path, canonicalize and confirm it stays inside the permitted root. *Rationale: an
attacker-controlled scheme or traversal reaching an OS sink is an input-validation boundary breach.
(This bridge has no current data-derived shell sink — it is the standing rule for any that is
added.)*

---

# Part II — Project bindings

This part records what is specific to *this* repo: the Bridge, the MCP/SDK surface, the cross-repo
error contract, the deterministic-JSON discipline, the contract recipes, npm shipping, the on-disk
module taxonomy, and the canonical in-tree exemplars. Part I's rules are the law; this part is where
they touch concrete files. Paths are relative to the server repo root, and each citation names a file
and a symbol, never a line: line numbers drift, the **symbol name is the durable anchor**.

## B1. The Bridge — the transport reference implementation

The Bridge is the stdio↔WebSocket reference implementation of [§7](#7-async-promises-and-the-event-loop):
it owns the editor channel plus the lazy playtest-runtime channel, the reconnect state machine, and
every cancellation/timeout guarantee.

- **Construction.** `createBridge(...)` (`src/transport/bridge.ts`) returns the single `Bridge`
  (`interface Bridge`, `src/shared/types.ts`) the tool layer calls. The low-level socket, reconnect, and
  pending-request bookkeeping live in `createChannel` (`src/transport/channel.ts`); the reconnect
  backoff tunable is `RECONNECT_BASE_MS` in the same file.
- **Cancellation ([§7.4](#7-async-promises-and-the-event-loop)).** A pre-aborted signal throws
  `CANCELLED` immediately (the channel's `call`, `src/transport/channel.ts`); an abort mid-flight
  clears the timer, rejects `CANCELLED`, and sends the toolkit a cooperative `_cancel` notification
  (`cancelPending`, same file).
- **Timeout ([§7.5](#7-async-promises-and-the-event-loop)).** Every call arms a timer that rejects
  `TIMEOUT` and deletes the pending entry (the channel's `call`); `_queued` / `_executing` progress
  notifications **reset** the timer so queued mutations don't false-timeout (the socket's `message`
  handler in `connect`, `src/transport/channel.ts`).
- **Process survival ([§7.6](#7-async-promises-and-the-event-loop)).** `installProcessHandlers`
  (`src/startup/lifecycle.ts`) installs the `unhandledRejection` / `uncaughtException` stderr
  loggers that keep the bridge alive.
- **Fire-and-forget exemplar ([§7.3](#7-async-promises-and-the-event-loop)).** `void
  bridge.call(...).catch(() => {})` in `sendLspStatus` (`src/lsp/lspStatusReporter.ts`) — a status
  push whose failure is safe to drop, marked `void` and commented.

## B2. MCP / SDK surface discipline

- **Register tools through the project wrapper, never the SDK directly — hard-line.** Use
  `registerToolWrapped` / `registerTools` (`src/registration/toolRegistry.ts`) — **never** the SDK's
  raw `server.registerTool` (called in exactly one place, the body of `registerToolWrapped`). The wrapper adds version-gating, path-guard pre-filtering,
  hook-pipeline wrapping, string-coercion, and tool-ref tracking; bypassing it silently drops those
  guarantees. Prompts / resources / roots go through their own registrars (`src/mcp/`).
- **SDK construction.** `McpServer` with `{ capabilities: { tools: { listChanged: true } } }`;
  `StdioServerTransport` built by `createStdioTransport` (`src/startup/lifecycle.ts`) and connected
  **last** (`await server.connect(transport)`, at the end of `src/index.ts`).
  Zod is the schema lib; raw JSON Schema from extensions is converted to a Zod shape by
  `jsonSchemaToZodShape` (`src/shared/schemaCoercion.ts`, invoked from `registerToolWrapped`).
- **stdout is the stdio transport — never `console.log` to stdout — hard-line.** **All** human
  diagnostics go to `process.stderr.write`. The only stdout writes are protocol frames and the
  pre-transport CLI reports that exit *before* `connect` (`printToolCount` for `--tools-count`,
  dispatched by `applyCliMetaGates` in `src/startup/startupEnv.ts`).
  A stray stdout write corrupts the JSON-RPC stream.
- **Coalesce a multi-tool registration change into a single `tools/list_changed`.** The SDK auto-emits
  `tools/list_changed` on every `registerTool` / `removeTool`, so a remove-then-rebuild (startup,
  config-reload, extension reconcile) fires a notification **burst** unless wrapped. Run any multi-tool
  mutation inside `batchToolRegistration` (`src/registration/toolRegistry.ts`), which suppresses the
  per-call emit and sends exactly **one** notification in its `finally`. *Rationale: a burst
  destabilizes clients that drop or restart their session on `tools/list_changed`.*

## B3. Error classification & the `ErrorCode` cross-repo contract

- **Classify every error to its specific code; never swallow or relabel across the bridge — hard-line.**
  `BridgeError(code, message)` (`src/shared/errors.ts`) carries a `code` from the canonical
  `ErrorCode` union (`src/shared/types.ts`). `toolErrorFromException`
  (`src/shared/errorContract.ts`) **preserves** `err.code` when `err instanceof BridgeError`, else
  `INTERNAL` — the transport code (`TIMEOUT` / `CANCELLED` / `CONNECT_FAILED` / …) is **never**
  flattened to a generic message, so the client can decide retry-vs-give-up. A plugin-returned
  `{ success: false, code }` is translated to an MCP `isError` response **without relabeling**
  (`toolErrorFromPayload`, same file).
- **The `ErrorCode` union is a cross-repo contract.** It must stay in sync with the toolkit's
  `MCPToolkitError.CODES` (in `addons/godot_mcp_toolkit/contract/mcp_toolkit_error.gd`); the sync
  obligation is documented at the union's definition (`ErrorCode`, `src/shared/types.ts`). A new plugin-emitted
  code touches **both** repos — it is a contract change
  ([B5](#b5-contract-surface-fidelity--cross-version-caveats)), not a unilateral add. Seven codes
  originate in the server and never travel through the plugin, so the toolkit does not list them:
  `AUTH_FAILED`, `CANCELLED`, `CLOSED`, `LSP_PORT_CONFLICT`, `LSP_UNAVAILABLE`, `RPC_ERROR`,
  `SEND_FAILED`.

## B4. Deterministic JSON & token discipline

- **Serialize the cacheable surface with stable key order.** `stableStringify`
  (`src/shared/stableJson.ts`) recursively sorts object keys so the re-sent tools/schema block is
  **byte-identical across turns**, matching the prompt cache. **Do not hand-roll `JSON.stringify` on
  the cacheable surface.**
- **Per-call responses use plain `JSON.stringify`** — serialized once into history, so sorting buys no
  cache hit. Know which surface you're on.
- **Schema minimization is token discipline** — the tool surface is kept to what the model needs;
  additions to it weigh tokens (the catalogue is the SSOT).

## B5. Contract-surface fidelity & cross-version caveats

The server is the **consumer** half of the cross-repo contract. These recipes must match the toolkit
**exactly**; the **contract document is toolkit-owned — `docs/dev/contract.md` in the toolkit repo is
the cross-repo SSOT**, which this repo cross-links rather than restating.

- **Token-path, project-key, WS-framing, and port ranges are contract.** The server validates the
  published token-path **shape** (`…/addons/godot_mcp_toolkit/project_instance_<hash>/mcp_token`,
  re-read every connect) in `assertPublishedTokenPath` (`src/transport/tokenPath.ts`); the project key
  is canonicalized and lowercased on win32/darwin by `normalizePath` (`src/registry.ts`). *The project-hash is computed
  **toolkit-side** — the server consumes the published path and only checks its shape, so there is no
  hash routine here to keep in sync, only the path recipe.* Ports bind on `127.0.0.1` via env /
  registry. Changing any recipe is a **contract change**, not a free refactor.
- **Version-gate at the wrapper.** Version-incompatible tools are filtered/blocked through
  `registerToolWrapped` + `src/shared/version.ts`; the out-of-range error must be informative
  (`UNSUPPORTED`). The wrapper skips registration when the version is **not yet known** and the startup
  reconcile re-runs once it resolves (the version filter in `registerToolWrapped`,
  `src/registration/toolRegistry.ts`).

### B5.x Paginating tools — shared fragment, REFLECT-only

Paginating tools share one fragment module (request-param zod fragments +
`paginationDoc(unit)` describe-builder + a read-side `PaginatedResult` type/consts).

- **Spread the shared request-param fragment** (`offset`/`limit`, or
  `start_line`/`end_line`) into the tool's `inputSchema` — the catalogue zod strips
  undeclared top-level params, so an un-spread `offset`/`limit` never reaches the
  toolkit (the load-bearing reason these params exist server-side).
- **Response is REFLECT — build NO envelope here.** The toolkit's `Pagination` class
  is the sole envelope author; the bridge forwards `message.result` verbatim. Never
  re-encode or re-shape a paginated response server-side. The only server code that
  *reads* the fields is the two NON-REFLECT summary handlers (`editor.ts`
  consoleSummary, `runtime.ts` debuggerLog) — they read via the shared
  `PaginatedResult` type/consts, never string literals, so a field rename touches
  one place.
- **Field names mirror the toolkit exactly** (`has_more`, `returned`,
  `total_<unit>`) — the cross-repo contract recipe. Describe the envelope with
  `paginationDoc(unit)` so every tool's prose is identical.

## B6. npm distribution, tooling & shipping hygiene

- **The `files` allowlist is the ship-control.** `package.json` `files: ["dist", "README.md",
  "LICENSE", "ATTRIBUTIONS.md"]` — **only `dist/` ships**; `src/`, `test/`, and `docs/` do **not**
  (there is no `.npmignore`). The package is scoped (`@npgamedev/godot-mcp-server`) with `bin:
  godot-mcp-server → dist/index.js`.
- **`engines.node >= 22`**, runtime-enforced — `enforceNodeVersion` (`src/startup/startupEnv.ts`)
  hard-exits below 22.
- **The build is the gate** (`noEmitOnError`): a green `dist/` means the typecheck passed; `postbuild`
  injects the bin shebang.
- **Route every tool through an `npm run` script; never a bare `npx`.** `build` / `lint` / `format` /
  `format:fix` / `test:unit` and the rest are the prompt-free, CI-aligned path; a bare `npx` is
  permission-gated and breaks autonomous runs. The unit-test runner spawns each test file via the
  Node binary already running it (`execFileSync(process.execPath, ["--import", "tsx", file])`,
  in the per-file loop of `test/unit/run-all.ts`) — per-file subprocess isolation with no PATH / `npx` dependency.
- **Generated API reference.** The public surface is published as **generated Markdown**
  (`npm run docs:api` → `typedoc` + `typedoc-plugin-markdown` → committed `docs/api/`), the
  contributor companion to `docs/architecture/`. It is **committed** (the Pages renderer does not run
  typedoc) and **excluded from the `files` allowlist** (repo / Pages only, never shipped to npm).
  Regenerate when canonical doc comments change ([§5.11.9](#511-the-typescript--tsdoc-doc-comment-layer)).

## B7. Module taxonomy & the composition root

`src/` is partitioned into bounded-context domain folders per
[§1.1](#1-file-folder-and-symbol-naming) / [§6.8](#6-design-solid-cohesion-and-decomposition), with
the `bin` entry and the multi-instance registry at the root:

| Folder | Holds |
|---|---|
| `shared/` | cross-cutting leaf modules: `types.ts` (the no-runtime-symbol leaf), `errors.ts` (split out of `types.ts` to keep it pure-type), `version.ts`, `stableJson.ts`, `schemaCoercion.ts`, `errorContract.ts` |
| `transport/` | the Bridge: `bridge.ts` (orchestrator) + `channel.ts`, `authHandshake.ts`, `heartbeat.ts`, `runtimeConnection.ts`, `tokenPath.ts` |
| `registration/` | the tool-wrapper surface: `toolRegistry.ts`, `toolDispatch.ts`, `toolMeta.ts`, `toolRefs.ts`, `catalogue.ts`, `extensionCollision.ts`, `screenshotResponse.ts` |
| `groups/` (+ `groups/defs/`) | on-demand tool-group activation + the per-group definitions |
| `tools/` | the built-in tool modules, each exporting `register(server, bridge, allowed)` |
| `extensions/` | per-project extension discovery + registration |
| `lsp/` | the LSP client + session |
| `security/` | path guard, profiles, untrusted-input handling |
| `startup/` | boot collaborators: `lifecycle.ts`, `startupEnv.ts`, `cliArgs.ts`, `portConfig.ts`, `projectPath.ts`, `bridgeOptions.ts`, `registrars.ts`, `configReload.ts`, `reconcile.ts`, `hooks.ts`, `serverMode.ts` |
| `mcp/` | prompts, resources, roots registrars |
| *root* | `index.ts` (the composition root / `bin` entry), `registry.ts` (multi-instance store), and its `registryLiveness.ts` leaf (entry-owner liveness) |

`index.ts` is the thin composition root of [§2.2](#2-module-structure-and-declaration-order): it
sequences the boot (preflight gates → bridge → registration → `server.connect`) and delegates each
phase to a `startup/` collaborator. The namespace-imported tool family it composes is wired by
`registerBuiltinModules` (`src/startup/registrars.ts`).

**A shape two modules build lives in the module that owns its seam**
([§6.4](#6-design-solid-cohesion-and-decomposition)). A handler wrapper, a hint injection or a version
grammar is one exported function in its owner (`registration/toolDispatch.ts` for dispatch,
`shared/version.ts` for versions), and both callers import it. A `groups/` or `extensions/` module
never re-implements what `registration/` already does.

## B8. Test-code conventions

The `test/` trees are OSS-public code held to all of Part I (naming, formatting, typing, comments
§5, DRY) — the intent-not-history bar applies across **comments, test-case labels, and assertion
messages** alike. On top of the general rules:

**The rules below bind the tests a change adds or edits:** a new test file, a new `{ … }` block, or an
existing block whose inputs, assertions, or messages the change alters. A block the change leaves alone
keeps its shape until a change touches it, and bringing untouched tests in line is its own test-only
change. A file-level rule (the file's module, its header, its entry-point signature, its fake factory)
binds a new file only. In an edited block, the rules bind the lines the change adds or alters; the
block's other assertions keep their inputs, values, and messages.

B8.1 **Bare `node:assert/strict`, no framework.** `import assert from "node:assert/strict"`, then
top-level scoped `{ … }` blocks, each an independent case, closing with
`console.log("All N tests passed.")`. No `describe` / `it`, no Jest / Vitest / Mocha. New tests match
this.

B8.2 **One test file per source module**, `<module>.test.ts` (bridge sub-aspects
`bridge-<aspect>.test.ts`). The runner auto-discovers `*.test.ts` (drop a file in; no central registry)
and fails fast. A test of a seam between modules goes in a file named for the seam, whose header names
the modules it covers. A module's cases live in one file. *Rationale: a reader finds a module's tests
from the module's name.*

B8.3 **Test helpers are stateless pure factories** — no shared mutable state across files; each returns
a restore closure so every test file is hermetic.

B8.4 The coverage **manifests** and maintenance protocols (`test/SMOKE-COVERAGE-MANIFEST.md`,
`test/SMOKE-MAINTENANCE-PROTOCOL.md`) are Markdown traceability where section refs are load-bearing —
out of scope for the intent-not-history strip except to reconcile a reference a rename made stale.

B8.5 **A unit drives one module through its exported interface.** A test imports what callers import and
asserts on what comes back: return values, thrown `BridgeError` codes, and what crossed a real boundary
(the frames a fake bridge received, the tools a fake server registered). A module-private function is
reached through the export that uses it. For a tool, the interface is what the model sees: its name,
description, input schema, and result and error payloads. *Rationale: a test that reaches past the
interface breaks on every refactor and proves nothing about what callers get.*

B8.6 **Tests move with the code, unaltered.** When a function moves to another module, its cases move to
that module's test file in the same change with the same inputs, expected values, and messages. Changing
what a moved case asserts is a separate change. *Rationale: a case left behind misleads the next reader
about where the behaviour lives, and an unaltered move is easy to verify in the diff.*

B8.7 **No new duplicate pins.** An input and its expected result are asserted in one place in the suite.
Before adding a case, search `test/unit/` for the same call and message, and extend the existing case if
one already pins it. A duplicate that already exists is reported in the change's description and left in
place: retiring an existing assertion is the maintainers' decision, made test by test. *Rationale: two
copies drift apart, and after the next change one of them is wrong.*

B8.8 **Every new case is seen to fail once.** A bug fix adds the case that reproduces the bug and runs
it red before the fix. A case for new behaviour fails before the behaviour exists. A case that pins
behaviour already in place passes on its first run, so its author breaks the pinned code once on purpose
(flips a branch, changes a constant), watches the case fail, and restores the code. The change's
description names the red run or the deliberate break. *Rationale: a test that has never failed may be
unable to.*

B8.9 **Extracting a module adds tests for it.** When a change moves behaviour out of a module into a new
module that the original then imports, the change adds `<newModule>.test.ts` driving the new module's
exports (B8.5). The original's tests stay as they are; any the new file makes redundant are listed in
the change's description for the maintainers to retire (B8.7). *Rationale: the extraction creates a new
contract, and an untested contract is the first to break.*

B8.10 **Expected values are written down, not computed.** An expected value is a literal taken from the
contract, the MCP specification, or a hand calculation. It never comes from the code under test, from a
copy of its algorithm, or from pasting what a run printed. *Rationale: an expected value derived from
the code passes by construction, including when the code is wrong.*

B8.11 **One behaviour per block, and every assertion says what it checks.** A `{ … }` block pins one
behaviour and holds at least one assertion. Each `assert` call carries a message stating the behaviour
in the contract's words (the state, the action, the result). *Rationale: a failure line should read as a
sentence about the contract.*

B8.12 **Edges and error paths are tested.** A response cap, truncation marker, page size, or version
floor is asserted at the limit and one step past it. A tool or function with a documented error result
has at least one assertion on that result, including its `ErrorCode`. *Rationale: off-by-one and
unhandled-error bugs live at the edges, which a suite of happy paths never reaches.*

B8.13 **A block restores what it changes, in `finally`.** A block that changes module-level state
(tracked tool refs, extension groups, the environment, a stderr capture) restores it in a `finally`,
through the `snapshotEnv` / `captureStderr` helpers where they apply. Sockets and child processes close,
and temp directories (`mkdtemp`) are removed, in the same `finally`. A block reads no state another
block left. *Rationale: the blocks of a file share one process (the runner isolates files, not blocks),
so a leak in one block fails a later one.*

B8.14 **Waits poll a condition, with a cap.** A block never sleeps to synchronise. It waits for a
condition by polling with a timeout that fails with a message naming what never happened, or drives the
timer the code under test arms. A block that asserts something does **not** happen waits a fixed window,
named in a constant with a comment. *Rationale: a sleep is slow on a fast machine and flaky on a slow
one.*

B8.15 **Collaborators are real; fakes sit at a real boundary.** The module under test and its in-process
collaborators run for real. A hand-written fake replaces only a real boundary: the SDK `McpServer`, the
toolkit bridge or its WebSocket, the filesystem, the environment, the clock. Loopback sockets and local
child processes are allowed; a real Godot and any network beyond loopback are not. An assertion checks
what the module did with a fake's answer, never the answer itself. *Rationale: a fake for your own code
makes the test check the fake.*

B8.16 **Tests are never weakened quietly.** A change that lowers the suite's assertion count, or a
file's count other than by an unaltered move (B8.6), comments out or skips a block, returns before a
block's assertions, or loosens an expected value has the maintainers' agreement in review, and its
description says which assertions changed and why. *Rationale: a green run with fewer checks looks the
same as a full one, so the drop has to be visible.*

B8.17 **Test comments follow §5, with a short header.** A test file's header states, in at most six
lines, what the file pins and through which export. It carries no change history ("the former X was
collapsed", "a later internal split"), no "mirrors `other.test.ts`" pointer (shared setup moves into
`test/unit/helpers.ts` instead), and no claim stronger than its assertions make. *Rationale: a
header is read by someone who never saw the history, which belongs in the commit message.*

B8.18 **Fakes are typed narrowly and cast once (§4).** A fake is typed by a narrow local `interface` or
a `Pick<…>` of the SDK type, and one factory per faked type in a file performs that type's single
`as unknown as` cast to the full type, with a comment naming what the fake leaves out. No `any` without
§4's inline justification. *Rationale: one documented cast keeps the fake honest about the surface it
skips.*

## B9. Decision trail & companions

- Per [§5.10](#510-relocating-stripped-rationale), stripped narrative rationale relocates to the
  **commit message** (the primary record) or a decision record; the repo's architectural decision
  trail is `docs/architecture/`. Shipped code never references the trail — linkage is one-way.
- *Optional companions:* a tool/term **contract** (`docs/dev/contract.md`, **toolkit-owned** — the
  cross-repo SSOT this server cross-links) and a server **glossary** (`docs/dev/glossary.md`)
  accompany this standard when present — align public names and contract shapes to them.

## B10. Canonical exemplars

The in-tree examples a reviewer or contributor jumps to, each cited by file and symbol (the **symbol
name is the durable anchor**).

- **Naming / typing.** `RECONNECT_BASE_MS` (`src/transport/channel.ts`) UPPER_SNAKE tunable; the
  `ErrorCode` union (`src/shared/types.ts`) UPPER_SNAKE members; `interface Bridge`
  (`src/shared/types.ts`); `readonly` array field `pathParams?: readonly PathGuard[]` (the
  `ToolDef` type, `src/shared/types.ts`).
- **Comments / TSDoc ([§5](#5-comments-and-documentation)).** `registerToolWrapped`
  (`src/registration/toolRegistry.ts`) — the exemplary doc comment: one-line summary, `@param`,
  `@remarks`, `@example`, plus the **sanctioned, justified `any` escape-hatch** on its `config`
  parameter. `stableStringify` (`src/shared/stableJson.ts`) — module header + intent-first function
  doc.
- **Cohesion ([§6](#6-design-solid-cohesion-and-decomposition)).** `index.ts` (composition root) +
  `src/startup/` collaborators; `transport/bridge.ts` (orchestrator) + `transport/channel.ts`;
  `shared/errors.ts` (`BridgeError`) split out of `shared/types.ts` to keep the latter a pure-type
  leaf; the DRY single-call wrapper `callAndWrap` (`src/registration/toolDispatch.ts`).
- **Async ([§7](#7-async-promises-and-the-event-loop)).** Cancellation + timeout in
  `src/transport/channel.ts` (`call`, `cancelPending`, and the progress-reset branch of the socket's
  `message` handler); process survival in `installProcessHandlers` (`src/startup/lifecycle.ts`);
  commented fire-and-forget `void … .catch(() => {})` in `sendLspStatus`
  (`src/lsp/lspStatusReporter.ts`).

---

## Appendix A — condensed review checklist

- [ ] Files `camelCase.ts`; identifiers per [§1.3](#1-file-folder-and-symbol-naming); relative imports
  end in `.js`; `import type` for type-only imports; module privacy via non-export (no `_` prefix).
- [ ] Build clean (no `any` except a justified inline escape-hatch; explicit return types on exports).
- [ ] Lint + format clean (**never a bare `npx`**, including the test runner); formatting left to the
  formatter.
- [ ] `undefined` preferred over `null`; `null` only at a JSON-wire / SDK boundary
  ([§4.6](#4-static-typing)).
- [ ] Errors classified to a specific `ErrorCode`; no swallow/relabel across the bridge; the only
  swallow is a commented fire-and-forget.
- [ ] No floating promises (`void` / `await` / `.catch`); cancellation + timeout honored; **no
  synchronous event-loop blocking** ([§7.1](#7-async-promises-and-the-event-loop)).
- [ ] Any data-derived value at an OS / shell / exec / open sink is validated (URL scheme allowlisted;
  path canonicalized inside the guard) ([§8](#8-untrusted-data-at-os-sinks-input-validation)).
- [ ] Cacheable surface via `stableStringify`; stdout never written outside the transport.
- [ ] Tools registered through `registerToolWrapped`, not the SDK directly; multi-tool changes wrapped
  in `batchToolRegistration` → one `tools/list_changed`.
- [ ] Comments state intent, not dev-history; TSDoc on public seams documents semantics not types;
  `@internal` on sibling-only exports.
- [ ] File has one statable responsibility ([§6.1](#6-design-solid-cohesion-and-decomposition)); a
  non-test file over 500 lines that a change touches has its one-sentence responsibility written
  down, and a sentence that needs "and" marks a decomposition candidate
  ([§6.3](#6-design-solid-cohesion-and-decomposition)); orchestrators stay thin; no import cycles;
  collaborators born in the right folder.
- [ ] A fix covers every site with the same defect; a shape two modules build is one function in the
  module that owns the seam, imported by both ([§6.4](#6-design-solid-cohesion-and-decomposition),
  [B7](#b7-module-taxonomy--the-composition-root)).
- [ ] Contract recipes (token-path / project-key / framing / ports / error codes) unchanged — or
  treated as a contract change against the toolkit-owned `docs/dev/contract.md`.
- [ ] `files` allowlist still ships only `dist/` (+ license / readme / attributions); `docs/` unshipped.
- [ ] Tests: a new or moved case sits in its module's `<module>.test.ts` (or `bridge-<aspect>.test.ts`,
  or a seam file whose header names its modules); moved cases unaltered; assertions go through the
  exported interface ([B8.2](#b8-test-code-conventions), [B8.5](#b8-test-code-conventions),
  [B8.6](#b8-test-code-conventions)).
- [ ] Tests: no new duplicate pin; an existing duplicate is reported, not deleted; no assertion dropped,
  block skipped, or expected value loosened without the maintainers' agreement
  ([B8.7](#b8-test-code-conventions), [B8.16](#b8-test-code-conventions)).
- [ ] Tests: each new case was seen red once (a fix's case before the fix; a pin by a deliberate break)
  and the description says how; an extraction ships `<newModule>.test.ts` and lists the pins it makes
  redundant ([B8.8](#b8-test-code-conventions), [B8.9](#b8-test-code-conventions)).
- [ ] Tests: expected values are literals; one behaviour per block; every `assert` has a message; caps
  tested at and past the limit; documented error results asserted with their code
  ([B8.10](#b8-test-code-conventions)–[B8.12](#b8-test-code-conventions)).
- [ ] Tests: module state, env, stderr, sockets, child processes, and temp dirs restored in `finally`;
  waits poll with a cap, no sleeps; fakes only at a real boundary
  ([B8.13](#b8-test-code-conventions)–[B8.15](#b8-test-code-conventions)).
- [ ] Tests: header at most six lines of intent, with no history, "mirrors" pointer, or overclaim; fakes
  typed narrowly with one commented cast per faked type ([B8.17](#b8-test-code-conventions),
  [B8.18](#b8-test-code-conventions)).

## Appendix B — documented exceptions & gaps

- **Extra-strict `tsconfig` flags not set** (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `noImplicitOverride`, `noPropertyAccessFromIndexSignature`) — a noted gap, **not** an as-built rule.
  Tightening is a post-1.0 consideration.
- **Justified `any` escape-hatches** (SDK overload shapes / third-party-schema internals), each
  inline-disabled with a one-line reason ([§4.1](#4-static-typing); exemplar: the `config` parameter
  of `registerToolWrapped`, `src/registration/toolRegistry.ts`). Permitted; do not add more without the same justification.
