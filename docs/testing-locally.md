---
title: Testing locally
permalink: /testing-locally/
nav_order: 5
---

# Testing locally

How to validate your changes before submitting a PR: what each test layer
covers, what it needs, when to run it, and how to add coverage when you add a
tool or an extension. This page is about the *workflow*. When something fails
at runtime and you need a symptom-to-fix answer, use the
[troubleshooting page](https://github.com/NPGameDev/godot-mcp-toolkit/blob/main/docs/troubleshooting.md)
— one canonical page for both repositories.

## Environment setup

- **Node.js >= 22** — the `engines` floor in `package.json`; the server exits
  with a clear error below it.
- `npm install`, then `npm run build`. The build compiles TypeScript into
  `dist/`, and `dist/` is what runs — `node dist/index.js` starts the server.
- To dogfood your local build from another project, `npm link` in this repo
  once, then point that project's MCP config at the linked `godot-mcp-server`
  binary.

Editor-dependent layers (smoke, flows, dispatch integration) need a running
Godot editor with the
[toolkit plugin](https://github.com/NPGameDev/godot-mcp-toolkit) enabled,
with a scene open. The editor-free layers run anywhere.

## The layers at a glance

| Layer | Command | Needs an editor? | When |
|-------|---------|------------------|------|
| Build | `npm run build` | No | After any `src/` edit |
| Format | `npm run format` | No | Before every commit |
| Lint | `npm run lint` | No | Before every commit |
| Unit tests | `npm run test:unit` | No | After any `src/` edit |
| Structural catalogue | `npm run smoke:ci` | No | After tool/schema changes |
| Smoke | `npm run smoke` | Yes | After tool changes; before milestones |
| Behavior flows | `npm run flows` | Yes | After workflow-level changes |
| Dispatch integration | `npm run test:integration:dispatch` | Yes | After transport/dispatch changes |
| Accuracy eval | `npm run eval` | Yes | When tuning descriptions/schemas |

## Build discipline — the one gotcha that lives here

**Run `npm run build` after every `src/` edit.** The server, the smoke suite's
bridge, and anything you exercise interactively all run from `dist/`, not from
the TypeScript source — forgetting the build means testing stale code while
staring at fresh source. Everything else that can bite you at runtime (port
collisions, token location, a client that missed a config change) is a
[troubleshooting](https://github.com/NPGameDev/godot-mcp-toolkit/blob/main/docs/troubleshooting.md)
matter, not a workflow one.

## Formatting and linting

```bash
npm run format       # Prettier check — CI enforces this
npm run format:fix   # fix violations
npm run lint         # ESLint
```

Always use the `npm run` scripts, never a bare `npx` invocation — the scripts
are the pinned, prompt-free path.

## Unit tests

```bash
npm run test:unit
```

Runs every unit file under `test/unit/` via one runner. Always run the whole
suite — it is fast, and there is deliberately no single-file script.

## Structural catalogue check

```bash
npm run smoke:ci
```

Editor-free static validation of the tool catalogue: names, schemas, group
membership, and the operation-count floor. This is the drift gate CI runs on
every push; run it locally after any change to tool definitions.

## Smoke tests

```bash
npm run smoke                          # the full suite
npm run smoke:single -- --only 5,7    # only the listed sections
```

The smoke suite exercises every tool against a live editor: happy path,
guards, and error hints. It connects through the same bridge module the server
itself uses, so a smoke pass covers the real wire contract. The `--only` flag
(comma-separated section numbers) belongs to `smoke:single`; `--from N` /
`--to N` / `--skip N,M` also work.

Coverage is tracked in
[`test/SMOKE-COVERAGE-MANIFEST.md`](../test/SMOKE-COVERAGE-MANIFEST.md), and
[`test/SMOKE-MAINTENANCE-PROTOCOL.md`](../test/SMOKE-MAINTENANCE-PROTOCOL.md)
defines when and how to update it. When any change adds or alters a tool, both
the manifest and the affected sections must be updated per the protocol.

## Behavior flows and accuracy eval

Two further editor-required suites, distinct from each other and from the
dispatch integration tests below:

- `npm run flows` — multi-step behavior flows (`test/flows/`): extension
  lifecycle, hot-reload reachability, combo chains.
- `npm run eval` — accuracy/efficiency scenarios (`test/eval/`) for judging
  tool-call quality, used when tuning descriptions and schemas.

## Dispatch integration tests

```bash
GODOT_MCP_TOKEN=<token> npm run test:integration:dispatch
```

Connects directly to the toolkit's WebSocket server (bypassing the MCP layer)
to observe queue notifications. The seven flows: mutation serialization, read
bypass, FIFO ordering, notification timing, cancellation, peer disconnect, and
scene lease contention. Requires a running editor; not CI-compatible.

Read the token from the plugin's per-project instance directory:
`user://addons/godot_mcp_toolkit/project_instance_<hash>/mcp_token` (on
Windows, `user://` is
`%APPDATA%/Godot/app_userdata/<project>/`).

## Testing against a live editor

1. Open your Godot project with the toolkit plugin enabled; confirm the dock
   reports the WebSocket server listening.
2. `npm run build`, then start the server from the project root
   (`node dist/index.js`, or via your MCP client's config).
3. Exercise tools through your MCP client (Claude Code, MCP Inspector, or any
   client from the [client setup guide](mcp-clients.md)) — a read-only probe
   like listing the scene tree is a good first call.

## Adding a tool — checklist

1. Define the `ToolDef` (schema, description, annotations) in the right
   `src/tools/` module.
2. Register it: eager tools join the startup list; group tools join their
   group definition.
3. Add a smoke section (or extend the matching one) and record it in
   `test/SMOKE-COVERAGE-MANIFEST.md` per the maintenance protocol.
4. `npm run build`, `npm run smoke:ci`, then `npm run smoke` (or
   `smoke:single -- --only <your section>`).
5. Verify interactively against a live editor if the tool touches the UI,
   editor state, or the running game.

## Testing an extension

Extensions register their commands in the editor (see the toolkit's
[extending guide](https://github.com/NPGameDev/godot-mcp-toolkit/blob/main/addons/godot_mcp_toolkit/docs/extending.md));
the server projects them as MCP tools automatically. To smoke-test yours
server-side, write a section in the same style as the core suite and run it in
isolation.

**How the harness works.** `test/smoke.ts` imports numbered section modules
from `test/sections/` and runs them through the shared orchestrator in
`test/harness.ts`, which handles port probing, token auth, pass/fail counting,
and the `--only` selection. Each section exports a `TOOLS_TESTED` list and a
test function that receives a `TestCtx` — including `bridge`, the same
WebSocket bridge the server uses, plus `pass` / `fail` reporters. Sections
call toolkit methods by their dotted wire names.

**Minimal template.** With your extension loaded in the running editor, a
section that verifies discovery and one call looks like this (model:
`test/sections/02_scene_node_basics.ts`):

```ts
// test/sections/50_my_extension.ts
import type { TestCtx } from "../helpers.js";
import { CALL_TIMEOUT } from "../helpers.js";

export const TOOLS_TESTED: string[] = ["my_extension_hello"];

export async function testMyExtension(ctx: TestCtx): Promise<void> {
  const { bridge, pass, fail } = ctx;

  // 1. The extension's commands are discoverable.
  const listed = (await bridge.call("extensions.list", {}, CALL_TIMEOUT)) as {
    success?: boolean;
    commands?: Array<{ method?: string }>;
  };
  const found = listed?.commands?.some((c) => c.method === "my_extension.hello");
  if (!found) {
    fail("extensions.list: my_extension.hello not reported — is the extension enabled?");
    return;
  }
  pass("extensions.list reports my_extension.hello");

  // 2. One real call, asserting the response shape.
  const result = (await bridge.call("my_extension.hello", { name: "smoke" }, CALL_TIMEOUT)) as {
    greeting?: string;
  };
  if (typeof result?.greeting === "string") pass(`my_extension.hello → ${result.greeting}`);
  else fail(`my_extension.hello: unexpected shape ${JSON.stringify(result)}`);
}
```

Wire it into `test/smoke.ts` next to the existing numbered imports, then run
it alone:

```bash
npm run build
npm run smoke:single -- --only 50
```

Running the full `npm run smoke` afterwards confirms your section coexists
with the core suite. The auth handshake is the harness's job — it discovers
the project's token from the registry; you never handle it in a section.

**In CI:** the same approach works against a headless editor — the toolkit's
[testing guide](https://github.com/NPGameDev/godot-mcp-toolkit/blob/main/docs/testing-locally.md)
documents the headless editor setup this builds on.

## When something fails

Symptom-shaped problems (nothing listening, auth failures, tools missing from
the list, log tools reporting busy) are collected in one place for both repos:
the
[troubleshooting page](https://github.com/NPGameDev/godot-mcp-toolkit/blob/main/docs/troubleshooting.md).
