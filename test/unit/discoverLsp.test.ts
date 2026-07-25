/**
 * Unit tests for the GDScript LSP endpoint discovery + resolution chain
 * (registry.discoverLspEndpoint / liveLspClaimants + lspClient.resolveLspEndpoint),
 * including the claimant-liveness policy both rest on.
 *
 * Drives a temp projects.json via a platform-appropriate env override (the same
 * var registryPath() reads). Claimant liveness is controlled on BOTH its axes,
 * each for real: the recorded PID via process.pid / process.ppid (alive) vs a
 * never-valid PID (dead), and the entry's advertised WS command port via actual
 * loopback listeners — one held open for a peer still serving, one bound then
 * released for a peer that is gone. A claimant counts only when both hold, so a
 * peer that is merely pid-alive (a recycled or foreign PID) must NOT contest the
 * port, while a genuinely-live rival still must.
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { normalizePath, discoverLspEndpoint, liveLspClaimants } from "../../src/registry.js";
import { classifyProbeOutcome, wsPortNotRefused } from "../../src/registryLiveness.js";
import {
  resolveLspEndpoint,
  LspResolutionError,
  getLspStatus,
  setGodotVersionGetter,
} from "../../src/lsp/lspClient.js";
import { captureStderr } from "./helpers.js";

const ALIVE = process.pid; // this test process — always alive
const ALIVE2 = process.ppid; // the runner (parent) — also alive, distinct PID
const DEAD = 2147483646; // never a live PID → process.kill throws ESRCH

// ── Loopback fixtures for the WS-port half of the predicate ──────────

/** A loopback listener plus the port it actually bound. The OS picks the port, so
 *  no case depends on what else happens to be listening on this machine. */
async function listen(): Promise<Server> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  return server;
}

function boundPort(server: Server): number {
  const address = server.address();
  if (address == null || typeof address === "string") throw new Error("loopback listener reported no numeric port");
  return address.port;
}

function close(server: Server): Promise<void> {
  return new Promise<void>((resolve) => server.close(() => resolve()));
}

// A live editor's WS command port: held open for the whole file.
const serving = await listen();
const SERVING_PORT = boundPort(serving);
// A closed editor's WS command port: bound (so it was provably free), then
// released. Binding first is what makes the refusal deterministic.
const vacated = await listen();
const REFUSED_PORT = boundPort(vacated);
await close(vacated);

type Entry = {
  port: number;
  token_path?: string;
  pid: number;
  started_at: number;
  runtime_port?: number | null;
  runtime_pid?: number | null;
  lsp_port?: number | null;
  lsp_host?: string;
};

/** Run fn with a temp projects.json whose by_path = the given entries. */
async function withRegistry(byPath: Record<string, Entry>, fn: () => Promise<void>): Promise<void> {
  const tmp = mkdtempSync(join(tmpdir(), "godot-mcp-reg-"));
  const saved: Record<string, string | undefined> = {};
  const setEnv = (k: string, v: string) => {
    saved[k] = process.env[k];
    process.env[k] = v;
  };
  // Mirror registry.ts registryPath() per platform.
  let dir: string;
  if (process.platform === "win32") {
    setEnv("APPDATA", tmp);
    dir = join(tmp, "godot-mcp-toolkit");
  } else if (process.platform === "darwin") {
    setEnv("HOME", tmp);
    dir = join(tmp, "Library", "Application Support", "godot-mcp-toolkit");
  } else {
    setEnv("XDG_DATA_HOME", tmp);
    dir = join(tmp, "godot-mcp-toolkit");
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "projects.json"), JSON.stringify({ by_path: byPath }));
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Default entry = a genuinely-live editor: pid alive AND its WS port answering.
 *  A case that wants a phantom peer opts in with `port: REFUSED_PORT`. */
function entry(over: Partial<Entry>): Entry {
  return {
    port: SERVING_PORT,
    token_path: "tok",
    pid: ALIVE,
    started_at: 1000,
    runtime_port: null,
    runtime_pid: null,
    lsp_port: 6005,
    lsp_host: "127.0.0.1",
    ...over,
  };
}

// No env override should leak in from the runner.
delete process.env.GODOT_MCP_LSP_PORT;
delete process.env.GODOT_MCP_LSP_HOST;

const projA = "/tmp/projA";
const keyA = normalizePath(projA);
const projB = "/tmp/projB";
const keyB = normalizePath(projB);

// ── The liveness predicate's two building blocks ─────────────────────

// classifyProbeOutcome — the fail-closed policy, as pure decision. A refusal is
// the only positive proof the advertised port has no listener; every other
// outcome says nothing about the peer, so the claimant stays counted.
{
  assert.equal(classifyProbeOutcome("ECONNREFUSED"), "dead", "classify: refusal → dead");
  for (const code of ["ETIMEDOUT", "EACCES", "EMFILE", "EHOSTUNREACH", "ENETDOWN", "SOMETHING_NEW"]) {
    assert.equal(classifyProbeOutcome(code), "indeterminate", `classify: ${code} → indeterminate (fail-closed)`);
  }
  assert.equal(classifyProbeOutcome(undefined), "indeterminate", "classify: timeout (no code) → indeterminate");
}

// wsPortNotRefused — the same policy over a real socket. Only the refused case
// returns false; a live listener and every unprobeable port both return true, which
// is the absence of proof of death rather than proof of life.
{
  assert.equal(await wsPortNotRefused(SERVING_PORT), true, "wsPortNotRefused: a listening port is not refused");
  assert.equal(await wsPortNotRefused(REFUSED_PORT), false, "wsPortNotRefused: a vacated port is refused");
  // An unprobeable port is not proof of death either — the runtime-only entries
  // the toolkit writes carry port -1.
  assert.equal(await wsPortNotRefused(-1), true, "wsPortNotRefused: unprobeable port → fail-closed");
  assert.equal(await wsPortNotRefused(70000), true, "wsPortNotRefused: out-of-range port → fail-closed");
}

// ── liveLspClaimants ─────────────────────────────────────────────────

await withRegistry(
  {
    [keyA]: entry({ lsp_port: 6005, pid: ALIVE }),
    [keyB]: entry({ lsp_port: 6005, pid: DEAD, started_at: 500 }),
  },
  async () => {
    const live = await liveLspClaimants(6005);
    assert.equal(live.length, 1, "liveLspClaimants: dead PID filtered");
    assert.equal(live[0].path, keyA, "liveLspClaimants: returns the live entry");
    assert.equal((await liveLspClaimants(6006)).length, 0, "liveLspClaimants: other port → none");
  },
);

// A pid-alive entry whose WS port refuses is a phantom, not a claimant.
await withRegistry(
  {
    [keyA]: entry({ lsp_port: 6005, pid: ALIVE }),
    [keyB]: entry({ lsp_port: 6005, pid: ALIVE2, port: REFUSED_PORT, started_at: 500 }),
  },
  async () => {
    const live = await liveLspClaimants(6005);
    assert.equal(live.length, 1, "liveLspClaimants: pid-alive but WS-refused entry filtered");
    assert.equal(live[0].path, keyA, "liveLspClaimants: the corroborated entry survives");
  },
);

// ── discoverLspEndpoint ──────────────────────────────────────────────

// Sole live claimant → own it.
await withRegistry({ [keyA]: entry({ lsp_port: 6005, lsp_host: "127.0.0.1" }) }, async () => {
  assert.deepEqual(
    await discoverLspEndpoint(projA),
    { host: "127.0.0.1", port: 6005 },
    "discover: sole claimant → endpoint",
  );
});

// A live peer started EARLIER holds the port → conflict.
await withRegistry(
  {
    [keyA]: entry({ lsp_port: 6005, started_at: 2000, pid: ALIVE }),
    [keyB]: entry({ lsp_port: 6005, started_at: 1000, pid: ALIVE2 }),
  },
  async () => {
    assert.deepEqual(
      await discoverLspEndpoint(projA),
      { conflict: true, port: 6005 },
      "discover: earlier live peer → conflict",
    );
  },
);

// THE REGRESSION LOCK — an earlier peer that is pid-alive but whose own WS port
// refuses is a dead editor whose PID got recycled. It must NOT contest the port:
// this is the false LSP_PORT_CONFLICT that blocked every lsp_* tool for a project
// served by exactly one editor.
await withRegistry(
  {
    [keyA]: entry({ lsp_port: 6005, started_at: 2000, pid: ALIVE }),
    [keyB]: entry({ lsp_port: 6005, started_at: 1000, pid: ALIVE2, port: REFUSED_PORT }),
  },
  async () => {
    assert.deepEqual(
      await discoverLspEndpoint(projA),
      { host: "127.0.0.1", port: 6005 },
      "discover: earlier phantom peer (pid alive, WS refused) → we own it",
    );
    assert.deepEqual(
      await resolveLspEndpoint(projA),
      { host: "127.0.0.1", port: 6005 },
      "resolve: earlier phantom peer does not throw",
    );
    assert.equal((await getLspStatus(projA)).state, "active", "getLspStatus: phantom peer → active");
  },
);

// The other side of the same coin — narrowing "counts as a claimant" must not
// widen into silently serving another project's symbols.
await withRegistry(
  {
    [keyA]: entry({ lsp_port: 6005, started_at: 2000, pid: ALIVE }),
    [keyB]: entry({ lsp_port: 6005, started_at: 1000, pid: ALIVE2 }),
  },
  async () => {
    assert.deepEqual(
      await discoverLspEndpoint(projA),
      { conflict: true, port: 6005 },
      "discover: earlier corroborated peer → still a conflict",
    );
    await assert.rejects(
      () => resolveLspEndpoint(projA),
      (e: unknown) => e instanceof LspResolutionError && e.code === "LSP_PORT_CONFLICT",
      "resolve: earlier corroborated peer → LSP_PORT_CONFLICT",
    );
    assert.equal((await getLspStatus(projA)).state, "conflict", "getLspStatus: corroborated peer → conflict");
  },
);

// A phantom peer must not mask a genuine one hiding behind it.
await withRegistry(
  {
    [keyA]: entry({ lsp_port: 6005, started_at: 3000, pid: ALIVE }),
    [keyB]: entry({ lsp_port: 6005, started_at: 1000, pid: ALIVE2, port: REFUSED_PORT }),
    [normalizePath("/tmp/projC")]: entry({ lsp_port: 6005, started_at: 2000, pid: ALIVE2 }),
  },
  async () => {
    assert.deepEqual(
      await discoverLspEndpoint(projA),
      { conflict: true, port: 6005 },
      "discover: phantom + genuine peers → the genuine one still conflicts",
    );
  },
);

// Equal started_at (same-second tie) → conflict (fails both sides).
await withRegistry(
  {
    [keyA]: entry({ lsp_port: 6005, started_at: 1000, pid: ALIVE }),
    [keyB]: entry({ lsp_port: 6005, started_at: 1000, pid: ALIVE2 }),
  },
  async () => {
    assert.deepEqual(
      await discoverLspEndpoint(projA),
      { conflict: true, port: 6005 },
      "discover: equal started_at → conflict",
    );
  },
);

// We started earliest vs a live peer → we own it.
await withRegistry(
  {
    [keyA]: entry({ lsp_port: 6005, started_at: 1000, pid: ALIVE }),
    [keyB]: entry({ lsp_port: 6005, started_at: 2000, pid: ALIVE2 }),
  },
  async () => {
    assert.deepEqual(
      await discoverLspEndpoint(projA),
      { host: "127.0.0.1", port: 6005 },
      "discover: we are earliest → own it",
    );
  },
);

// A DEAD earlier peer is ignored → we own it.
await withRegistry(
  {
    [keyA]: entry({ lsp_port: 6005, started_at: 2000, pid: ALIVE }),
    [keyB]: entry({ lsp_port: 6005, started_at: 1000, pid: DEAD }),
  },
  async () => {
    assert.deepEqual(
      await discoverLspEndpoint(projA),
      { host: "127.0.0.1", port: 6005 },
      "discover: dead earlier peer ignored → own it",
    );
  },
);

// No entry for the project → null (miss).
await withRegistry({ [keyB]: entry({}) }, async () => {
  assert.equal(await discoverLspEndpoint(projA), null, "discover: no entry → null");
});

// Entry present but lsp_port null (e.g. runtime self-heal entry) → null.
await withRegistry({ [keyA]: entry({ lsp_port: null }) }, async () => {
  assert.equal(await discoverLspEndpoint(projA), null, "discover: lsp_port null → null");
});

// Custom host/port flow through.
await withRegistry({ [keyA]: entry({ lsp_port: 6010, lsp_host: "127.0.0.2" }) }, async () => {
  assert.deepEqual(await discoverLspEndpoint(projA), { host: "127.0.0.2", port: 6010 }, "discover: custom host/port");
});

// ── resolveLspEndpoint (resolution order) ────────────────────────────

// 1. env override wins over the registry.
await withRegistry({ [keyA]: entry({ lsp_port: 6005 }) }, async () => {
  process.env.GODOT_MCP_LSP_PORT = "6099";
  try {
    assert.deepEqual(
      await resolveLspEndpoint(projA),
      { host: "127.0.0.1", port: 6099 },
      "resolve: env port overrides registry",
    );
    process.env.GODOT_MCP_LSP_HOST = "127.0.0.9";
    assert.deepEqual(await resolveLspEndpoint(projA), { host: "127.0.0.9", port: 6099 }, "resolve: env host honored");
  } finally {
    delete process.env.GODOT_MCP_LSP_PORT;
    delete process.env.GODOT_MCP_LSP_HOST;
  }
});

// 1b. The override bypasses the registry outright — even a corroborated rival
// claimant cannot override an explicit pin (the documented multi-instance lever).
await withRegistry(
  {
    [keyA]: entry({ lsp_port: 6005, started_at: 2000, pid: ALIVE }),
    [keyB]: entry({ lsp_port: 6005, started_at: 1000, pid: ALIVE2 }),
  },
  async () => {
    process.env.GODOT_MCP_LSP_PORT = "6099";
    try {
      assert.deepEqual(
        await resolveLspEndpoint(projA),
        { host: "127.0.0.1", port: 6099 },
        "resolve: env override wins over a genuine conflict",
      );
    } finally {
      delete process.env.GODOT_MCP_LSP_PORT;
    }
  },
);

// 1c. an INVALID env override is skipped LOUDLY → falls through to the registry.
// The env var is re-read live on every connect (a config reload can rewrite it
// mid-session, after the startup validation gate has passed), so a bad value
// must warn on stderr and degrade to discovery — never crash the resolution.
await withRegistry({ [keyA]: entry({ lsp_port: 6005 }) }, async () => {
  for (const bad of ["not_a_number", "99999"]) {
    process.env.GODOT_MCP_LSP_PORT = bad;
    const stderr = captureStderr();
    try {
      assert.deepEqual(
        await resolveLspEndpoint(projA),
        { host: "127.0.0.1", port: 6005 },
        `resolve: invalid env override "${bad}" falls through to the registry`,
      );
      assert.ok(
        stderr.output().includes("invalid LSP port override"),
        `resolve: invalid env override "${bad}" warns on stderr`,
      );
    } finally {
      stderr.restore();
      delete process.env.GODOT_MCP_LSP_PORT;
    }
  }
});

// 2. registry hit (no env).
await withRegistry({ [keyA]: entry({ lsp_port: 6005 }) }, async () => {
  assert.deepEqual(await resolveLspEndpoint(projA), { host: "127.0.0.1", port: 6005 }, "resolve: registry hit");
});

// 3. registry conflict → throws LSP_PORT_CONFLICT.
await withRegistry(
  {
    [keyA]: entry({ lsp_port: 6005, started_at: 2000, pid: ALIVE }),
    [keyB]: entry({ lsp_port: 6005, started_at: 1000, pid: ALIVE2 }),
  },
  async () => {
    await assert.rejects(
      () => resolveLspEndpoint(projA),
      (e: unknown) => e instanceof LspResolutionError && e.code === "LSP_PORT_CONFLICT",
      "resolve: registry conflict → LSP_PORT_CONFLICT",
    );
  },
);

// 4. miss + 6005 free → 6005.
await withRegistry({}, async () => {
  assert.deepEqual(
    await resolveLspEndpoint(projA),
    { host: "127.0.0.1", port: 6005 },
    "resolve: miss + free 6005 → 6005",
  );
});

// 5. miss + 6005 held by a LIVE editor → LSP_UNAVAILABLE (no blind fallback).
await withRegistry({ [keyB]: entry({ lsp_port: 6005, pid: ALIVE }) }, async () => {
  await assert.rejects(
    () => resolveLspEndpoint(projA),
    (e: unknown) => e instanceof LspResolutionError && e.code === "LSP_UNAVAILABLE",
    "resolve: ambiguous miss → LSP_UNAVAILABLE (no blind 6005)",
  );
});

// 6. miss + 6005 held only by a DEAD editor → 6005 (stale entry ignored).
await withRegistry({ [keyB]: entry({ lsp_port: 6005, pid: DEAD }) }, async () => {
  assert.deepEqual(
    await resolveLspEndpoint(projA),
    { host: "127.0.0.1", port: 6005 },
    "resolve: miss + dead 6005 holder → 6005",
  );
});

// 7. miss + 6005 held only by a PHANTOM (pid alive, WS refused) → 6005. The same
// predicate gates the miss path, so the recycled-PID false positive surfaced here
// as a spurious LSP_UNAVAILABLE.
await withRegistry({ [keyB]: entry({ lsp_port: 6005, pid: ALIVE2, port: REFUSED_PORT }) }, async () => {
  assert.deepEqual(
    await resolveLspEndpoint(projA),
    { host: "127.0.0.1", port: 6005 },
    "resolve: miss + phantom 6005 holder → 6005",
  );
  assert.equal((await getLspStatus(projA)).state, "active", "getLspStatus: miss + phantom holder → active");
});

// ── getLspStatus (verdict the server reports to the dock) ────────────

// Owner → active, with host/port.
await withRegistry({ [keyA]: entry({ lsp_port: 6005, lsp_host: "127.0.0.1" }) }, async () => {
  assert.deepEqual(
    await getLspStatus(projA),
    { state: "active", host: "127.0.0.1", port: 6005, detail: "Owns the GDScript LSP port." },
    "getLspStatus: owner → active",
  );
});

// Earlier live peer → conflict, carrying the contested port.
await withRegistry(
  {
    [keyA]: entry({ lsp_port: 6005, started_at: 2000, pid: ALIVE }),
    [keyB]: entry({ lsp_port: 6005, started_at: 1000, pid: ALIVE2 }),
  },
  async () => {
    const s = await getLspStatus(projA);
    assert.equal(s.state, "conflict", "getLspStatus: earlier peer → conflict");
    assert.equal(s.port, 6005, "getLspStatus: conflict carries the port");
  },
);

// Ambiguous miss (6005 held by a live editor) → unavailable.
await withRegistry({ [keyB]: entry({ lsp_port: 6005, pid: ALIVE }) }, async () => {
  const s = await getLspStatus(projA);
  assert.equal(s.state, "unavailable", "getLspStatus: ambiguous miss → unavailable");
  assert.equal(s.port, 6005, "getLspStatus: unavailable carries the port");
});

// ── lspConflictHint — version-tailored recovery (via resolveLspEndpoint) ──
// The auto-rebind window is CLOSED AT BOTH ENDS: 4.5 retries the LSP bind until it
// succeeds, so closing the other editor recovers the port there and only there.
// 4.2-4.4 never had the retry, and 4.6 onward latched the bind to a single attempt,
// so both need distinct ports or an editor restart. The hint must offer only the
// applicable path — advertising auto-rebind to a version that cannot do it sends the
// caller to wait for a recovery that never comes.

async function conflictHint(): Promise<string> {
  let hint = "";
  await withRegistry(
    {
      [keyA]: entry({ lsp_port: 6005, started_at: 2000, pid: ALIVE }),
      [keyB]: entry({ lsp_port: 6005, started_at: 1000, pid: ALIVE2 }),
    },
    async () => {
      try {
        await resolveLspEndpoint(projA);
      } catch (e) {
        if (e instanceof LspResolutionError) hint = e.hint;
      }
    },
  );
  return hint;
}

setGodotVersionGetter(() => [4, 5]);
{
  const h = await conflictHint();
  assert.ok(h.includes("rebinds the port automatically"), "hint(4.5) → offers auto-rebind recovery");
  assert.ok(!h.includes("won't recover"), "hint(4.5) → omits the no-recovery caveat the other versions get");
}

// 4.6 and 4.7 latched the bind to one attempt, so they get the distinct-port path,
// not the auto-rebind one. Both are locked so neither drifts back.
for (const minor of [6, 7]) {
  setGodotVersionGetter(() => [4, minor]);
  const h = await conflictHint();
  assert.ok(
    h.includes("won't recover this LSP without restarting"),
    `hint(4.${minor}) → distinct-port (the bind is latched to one attempt)`,
  );
  assert.ok(
    !h.includes("rebinds the port automatically"),
    `hint(4.${minor}) → never promises auto-rebind (closing the other editor cannot recover it)`,
  );
}

setGodotVersionGetter(() => [4, 2]);
{
  const h = await conflictHint();
  assert.ok(h.includes("won't recover this LSP without restarting"), "hint(4.2) → distinct-port, no auto-rebind");
  assert.ok(!h.includes("rebinds the port automatically"), "hint(4.2) → omits the auto-rebind claim");
}

setGodotVersionGetter(() => [4, 4]);
assert.ok(
  (await conflictHint()).includes("won't recover this LSP without restarting"),
  "hint(4.4) → distinct-port (4.4 is pre-retry)",
);

setGodotVersionGetter(() => undefined);
{
  const h = await conflictHint();
  assert.ok(
    h.includes("only Godot 4.5 rebinds automatically") &&
      h.includes("on every other version, restart this editor afterwards"),
    "hint(unknown) → names 4.5 as the only auto-rebind version and covers the rest",
  );
  assert.ok(!h.includes("4.5+"), "hint(unknown) → no open-ended 4.5+ rebind claim");
}
setGodotVersionGetter(() => undefined); // reset module-level state

await close(serving);

console.log("All discover_lsp tests passed.");
