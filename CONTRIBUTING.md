# Contributing to Godot MCP Server

Thank you for your interest in contributing! This guide covers everything you
need to get started.

## Prerequisites

- **Node.js >= 22**
- **Godot 4.x** (4.4+ recommended, for running the companion plugin)
- **Git**

This project spans three repositories that live as siblings on disk:

| Repo | What it is |
|------|-----------|
| [`godot-mcp-toolkit`](https://github.com/NPGameDev/godot-mcp-toolkit) | Godot editor plugin (GDScript) |
| [`godot-mcp-server`](https://github.com/NPGameDev/godot-mcp-server) (this repo) | TypeScript MCP bridge (npm package) |
| [`godot-mcp-creation`](https://github.com/NPGameDev/godot-mcp-creation) | Execution plan and design docs |

Clone all three as siblings:

```bash
git clone https://github.com/NPGameDev/godot-mcp-toolkit.git
git clone https://github.com/NPGameDev/godot-mcp-server.git
git clone https://github.com/NPGameDev/godot-mcp-creation.git  # optional, for plan context
```

## Dev environment setup

### 1. Install and build

```bash
cd godot-mcp-server
npm install
npm run build    # tsc -> dist/
```

### 2. Start the Godot plugin

Open the toolkit repo root in Godot 4.4+, then enable the plugin:

**Project Settings -> Plugins -> "Godot MCP Toolkit" -> Active**

Leave the editor running. The server connects to the plugin's WebSocket on
`127.0.0.1:6550`.

### 3. Verify the connection

```bash
npm run smoke
```

The smoke test port-checks `127.0.0.1:6550`. If nothing is listening, it prints
instructions and exits. Make sure the Godot editor is running with the plugin
enabled.

## Running checks

The commands below are the quick reference. For the full local testing
workflow — what each layer covers, when to run it, the environment each layer
needs, and how to add a test when you add a tool or an extension — see
[`docs/testing-locally.md`](docs/testing-locally.md).

### Linting

```bash
npm run lint         # ESLint (src/ and test/)
```

ESLint uses flat config (`eslint.config.js`) with typescript-eslint recommended
rules and eslint-config-prettier.

### Formatting

```bash
npm run format       # Prettier check (all files)
npm run format:fix   # auto-fix formatting
```

Prettier config: 2-space indent, double quotes, semicolons, trailing commas,
120-char print width.

### Smoke test

```bash
npm run smoke        # single-pass: all tools always available
```

The Godot editor must be running with the plugin enabled for smoke tests to pass.

> **Known engine bug (root-caused; smoke no longer arms it):** setting a node's
> `editor_description` and deleting that node within ~0.5 s triggers a
> use-after-free in the Godot editor's `SceneTreeEditor` tooltip timer (engine
> bug, Godot 4.3+, not ours). Section 02 used to do exactly that and would
> SIGSEGV the editor on a full-run-then-`--only 2` sequence; it now round-trips
> `editor_description` on the never-deleted scene root, so the suite is
> deterministically safe (verified 6/6 on the former killer recipe). If you
> write a NEW test that sets `editor_description` then deletes the same node,
> target the scene root (or another node you don't delete). Belt-and-suspenders:
> if a run ever dies with `WebSocket closed before response` and the editor
> process is gone, relaunch the editor and re-run — it's this engine flake, not
> the suite.

### Build

```bash
npm run build        # TypeScript -> dist/
```

Always build before running smoke tests to pick up your changes.

## Continuous integration

CI runs in two tiers, plus a release path. The authoritative detail (job shapes,
the sibling-pin ritual, the warm-up mechanics) lives in the header comments of each
workflow under `.github/workflows/` — this is the contributor-facing summary.

- **Floor — gates every push and PR** (`ci.yml`). A Node **22 + 24** matrix runs
  `build`, `test:unit`, `lint`, `format`, and `smoke:ci` (the editor-free static
  catalogue check), alongside an editor-free **C# SDK-compile floor** (three
  Godot.NET.Sdk / TFM boundary rows). A single aggregate job, **`Server floor OK`**,
  `needs:` the whole floor — that one name is what a required check binds to, never
  an individual matrix row. No Godot editor is involved; the floor is fast and green
  is a merge precondition.
- **Deep tier — opt-in** (`cross-version.yml`). The full **two-editor behavioral
  matrix** — GDScript-editor and .NET/mono-editor, Godot **4.2 through 4.7** — boots
  a real headless editor and round-trips the complete smoke + flows suites through
  the WebSocket bridge, plus a **dispatch-integration** leg on one row. It does not
  run on a plain push. Trigger it by putting **`[run-cross-version-ci]`** in your
  commit message, via **`workflow_dispatch`** (optionally with a `sibling-ref`
  override), or automatically as part of a release (below).
- **Release** (`release.yml`). A **`v*` tag push** first runs the deep behavioral
  matrix (the publish job `needs:` it — a cross-version regression can never ship),
  then a package-shape gate (`npm pack` + `publint` + generated-docs freshness)
  before it publishes to npm and cuts a GitHub Release. You can rehearse the whole
  path without publishing by running `release.yml` via **`workflow_dispatch`** — it
  is a **dry-run** by default (everything runs; publish + Release are skipped).

The behavioral tier is **mirrored in both repos** (toolkit and server): each side
runs the full two-editor matrix against a pinned SHA of the other, so an opt-in run
in either repo proves the whole GDScript + .NET contract for that repo's change. It
is opt-in only and driven by one shared composite action, so the mirror costs
nothing when idle and cannot drift between the two repos.

## Versioning

We follow semver — see [RELEASING.md](RELEASING.md) for what constitutes
major/minor/patch. The toolkit and server are versioned **independently** (each
its own version and cadence), so a bump lands on whichever repo actually
changed. You do NOT need to bump versions in your PR — the maintainer handles
that at release time. However, please flag in your PR description if your change
is **breaking** (removes/renames a tool, changes a parameter schema) or if it
introduces a **cross-repo dependency** (a server change that needs a newer
toolkit, or vice versa), so it's versioned and floor-bumped correctly.

## Documentation

### Generated files — never hand-edit

Three parts of `docs/` are generated from the source and regenerated by a script.
Editing them by hand is wasted work: the next regeneration overwrites your
changes, and CI checks them for drift. Change the source, then regenerate.

| Generated output | Regenerate with | Source of truth |
|------------------|-----------------|-----------------|
| `docs/tool-reference/` | `npm run docs:tools` | the tool catalogue (`src/registration/catalogue.ts`) |
| `docs/api/` | `npm run docs:api` | TSDoc comments in `src/` |
| the token figures in `docs/token-efficiency.md` | `npm run measure:tokens` | the live tool surface |

Always use the `npm run` scripts, never a bare `npx` — the npm scripts are the
prompt-free, pinned path.

The tool-reference document has one exception to "do not edit": the
`<!-- examples:start -->` … `<!-- examples:end -->` islands. Everything **inside**
those markers is hand-curated and survives regeneration, so that is where a
worked example for a tool belongs. Everything outside the islands is generated —
leave it to the script.

### Numbers come from a generator or a gate, never a copy

A number appears in prose only if a generator emits it or CI asserts it. Do not
hand-copy a tool count, group count, or operation count into a doc — hand-copied
counts drift, and a stale count in a README reads as carelessness. The structural
catalogue test (`npm run smoke:ci`) is the backstop: it asserts the counts the
README publishes against the catalogue, and it fails the build if the built-in
operation count ever drops below the published `150+` floor. When you add a tool
or a group, the counts follow from the catalogue automatically; regenerate the
tool-reference and let the gate confirm the headline still holds.

### Where docs live

This repo's user docs live on GitHub. The npm package ships only `dist/`, the
README, the LICENSE, and the attributions — the README is the only documentation
that travels with an install. Deeper docs (the tool reference, token efficiency,
client setup, architecture) are read on GitHub, not bundled. The Godot toolkit
addon is the only piece of this project that ships documentation *into* a user's
project, so anything a user must be able to read from inside the editor belongs in
the toolkit, not here.

When you add or move a doc, update the doc map so an agent or a contributor can
find it: `AGENTS.md` is the tool-agnostic doc map (and `docs/README.md` if the
repo carries a separate doc index). A doc that is not linked from the map is a doc
nobody finds.

### Writing for the entry points

The README and other front-door surfaces are held to a plainer standard than the
code:

- State what something does and show the evidence for it. Skip hype adjectives
  ("powerful", "seamless", "comprehensive") and superlatives — they read as
  filler and invite trust problems.
- Write complete sentences, not arrow chains (`A → B → profit`) or fragment
  bullets. Let an important section run long and a minor one be a single line;
  do not pad every section to the same length.
- Put a limitation next to the claim it qualifies, and keep the specific
  version and platform gotchas — that concrete, honest detail is the house voice.
- Reserve GitHub alert callouts (`> [!IMPORTANT]`, `> [!WARNING]`) for the two
  genuinely load-bearing warnings: use the mono (.NET) editor for C# projects, and
  pin the port on both the server and the plugin. Nothing else earns an alert.
- Avoid the machine-generated tells: dash-heavy sentences and invented hyphenated
  compounds. Plain prose.

### Screenshots

A screenshot embedded in the README carries a short provenance comment above it
(what it shows and when it was captured) and uses an absolute raw URL, because npm
renders the README from the package and cannot resolve a repo-relative image path.
The images themselves live in the toolkit repo.

## Dependency policy

All npm dependencies use **exact** versions (no `^` or `~` prefixes). This
ensures reproducible installs. Dependency updates are deliberate PRs, not
silent drift from caret ranges. When adding a dependency, pin it:

```bash
npm install --save-exact some-package
```

## Code standards

This repo ships its own coding standards. Read them before writing code, along
with the cross-repo contract — which lives in the toolkit repo, since the toolkit
owns the command surface. New to the codebase? Read these in order:

1. [`docs/architecture/README.md`](docs/architecture/README.md) — the
   subsystems, the contract surface, and the transport, with diagrams. Start here
   for the big picture.
2. [`docs/dev/code-standards.md`](docs/dev/code-standards.md) — idiomatic
   TypeScript/Node style, naming, static typing, async discipline, and comment
   conventions, plus the MCP/SDK and deterministic-JSON rules every contribution
   must respect.
3. [Toolkit `docs/dev/contract.md`](https://github.com/NPGameDev/godot-mcp-toolkit/blob/main/docs/dev/contract.md)
   — the request/response and transport contract between the toolkit and the
   server. The toolkit owns it; read it before touching the bridge, response
   handling, or anything on the wire.
4. [`docs/dev/glossary.md`](docs/dev/glossary.md) — the shared vocabulary used
   throughout the code and docs.

For the rationale behind larger design choices, the trail is the commit history
and the architecture document above — this repo does not keep a separate
decision-record directory.

## Submitting changes

### Branch naming

Use descriptive branch names: `feat/add-x`, `fix/crash-on-y`,
`docs/update-readme`.

### Commit format

We use [Conventional Commits](https://www.conventionalcommits.org/). One commit
per logical change.

```
<type>(<scope>): <imperative description>
```

**Types:** `feat`, `fix`, `refactor`, `docs`, `chore`, `test`, `build`

**Scopes:** `server`, `tools`, `config`

**Examples:**
- `feat(server): add classdb_search tool`
- `fix(tools): handle disconnected bridge in callAndWrap`
- `docs(config): update environment variable table`

### Pull request checklist

- [ ] `npm run build` succeeds
- [ ] `npm run lint` passes
- [ ] `npm run format` passes
- [ ] Smoke test passes (`npm run smoke`)
- [ ] Code follows the [coding standards](docs/dev/code-standards.md)
- [ ] Contract changes are reflected in the [toolkit contract](https://github.com/NPGameDev/godot-mcp-toolkit/blob/main/docs/dev/contract.md)
- [ ] No unrelated changes included
- [ ] Commit message follows Conventional Commits format
- [ ] CHANGELOG.md updated if user-facing

### What makes a good PR

- **Small and focused.** One feature or fix per PR.
- **Tested.** Describe how you verified the change works.
- **Documented.** Update CLAUDE.md or inline comments if behavior changes.

## Adding a tool

See the "Adding a tool" section in [CLAUDE.md](CLAUDE.md) for the step-by-step
checklist.

## Architecture overview

For an in-depth, up-to-date explanation of the server's subsystems, the contract
surface it shares with the toolkit, and the key design decisions, read the
in-repo architecture document:

[`docs/architecture/README.md`](docs/architecture/README.md)

It renders on GitHub with diagrams inline and is the canonical reference for how
the server fits together.

## Code of conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md).
Please read it before participating.

## Questions?

Open a [discussion](https://github.com/NPGameDev/godot-mcp-server/issues) or
file an issue. We're happy to help.
