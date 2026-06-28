/**
 * Unit tests for the GDScript LSP endpoint discovery + resolution chain
 * (registry.discoverLspEndpoint / liveLspClaimants + lsp_client.resolveLspEndpoint).
 *
 * Drives a temp projects.json via a platform-appropriate env override (the same
 * var registryPath() reads) and controls PID liveness with process.pid /
 * process.ppid (alive, distinct) vs a never-valid PID (dead).
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { normalizePath, discoverLspEndpoint, liveLspClaimants } from "../../src/registry.js";
import { resolveLspEndpoint, LspResolutionError, getLspStatus, setGodotVersionGetter } from "../../src/lsp_client.js";

const ALIVE = process.pid; // this test process — always alive
const ALIVE2 = process.ppid; // the runner (parent) — also alive, distinct PID
const DEAD = 2147483646; // never a live PID → process.kill throws ESRCH

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
function withRegistry(byPath: Record<string, Entry>, fn: () => void): void {
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
    fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(tmp, { recursive: true, force: true });
  }
}

function entry(over: Partial<Entry>): Entry {
  return {
    port: 6550,
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

// ── liveLspClaimants ─────────────────────────────────────────────────

withRegistry(
  {
    [keyA]: entry({ lsp_port: 6005, pid: ALIVE }),
    [keyB]: entry({ lsp_port: 6005, pid: DEAD, started_at: 500 }),
  },
  () => {
    const live = liveLspClaimants(6005);
    assert.equal(live.length, 1, "liveLspClaimants: dead PID filtered");
    assert.equal(live[0].path, keyA, "liveLspClaimants: returns the live entry");
    assert.equal(liveLspClaimants(6006).length, 0, "liveLspClaimants: other port → none");
  },
);

// ── discoverLspEndpoint ──────────────────────────────────────────────

// Sole live claimant → own it.
withRegistry({ [keyA]: entry({ lsp_port: 6005, lsp_host: "127.0.0.1" }) }, () => {
  assert.deepEqual(discoverLspEndpoint(projA), { host: "127.0.0.1", port: 6005 }, "discover: sole claimant → endpoint");
});

// A live peer started EARLIER holds the port → conflict.
withRegistry(
  {
    [keyA]: entry({ lsp_port: 6005, started_at: 2000, pid: ALIVE }),
    [keyB]: entry({ lsp_port: 6005, started_at: 1000, pid: ALIVE2 }),
  },
  () => {
    assert.deepEqual(
      discoverLspEndpoint(projA),
      { conflict: true, port: 6005 },
      "discover: earlier live peer → conflict",
    );
  },
);

// Equal started_at (same-second tie) → conflict (fails both sides).
withRegistry(
  {
    [keyA]: entry({ lsp_port: 6005, started_at: 1000, pid: ALIVE }),
    [keyB]: entry({ lsp_port: 6005, started_at: 1000, pid: ALIVE2 }),
  },
  () => {
    assert.deepEqual(
      discoverLspEndpoint(projA),
      { conflict: true, port: 6005 },
      "discover: equal started_at → conflict",
    );
  },
);

// We started earliest vs a live peer → we own it.
withRegistry(
  {
    [keyA]: entry({ lsp_port: 6005, started_at: 1000, pid: ALIVE }),
    [keyB]: entry({ lsp_port: 6005, started_at: 2000, pid: ALIVE2 }),
  },
  () => {
    assert.deepEqual(
      discoverLspEndpoint(projA),
      { host: "127.0.0.1", port: 6005 },
      "discover: we are earliest → own it",
    );
  },
);

// A DEAD earlier peer is ignored → we own it.
withRegistry(
  {
    [keyA]: entry({ lsp_port: 6005, started_at: 2000, pid: ALIVE }),
    [keyB]: entry({ lsp_port: 6005, started_at: 1000, pid: DEAD }),
  },
  () => {
    assert.deepEqual(
      discoverLspEndpoint(projA),
      { host: "127.0.0.1", port: 6005 },
      "discover: dead earlier peer ignored → own it",
    );
  },
);

// No entry for the project → null (miss).
withRegistry({ [keyB]: entry({}) }, () => {
  assert.equal(discoverLspEndpoint(projA), null, "discover: no entry → null");
});

// Entry present but lsp_port null (e.g. runtime self-heal entry) → null.
withRegistry({ [keyA]: entry({ lsp_port: null }) }, () => {
  assert.equal(discoverLspEndpoint(projA), null, "discover: lsp_port null → null");
});

// Custom host/port flow through.
withRegistry({ [keyA]: entry({ lsp_port: 6010, lsp_host: "127.0.0.2" }) }, () => {
  assert.deepEqual(discoverLspEndpoint(projA), { host: "127.0.0.2", port: 6010 }, "discover: custom host/port");
});

// ── resolveLspEndpoint (resolution order) ────────────────────────────

// 1. env override wins over the registry.
withRegistry({ [keyA]: entry({ lsp_port: 6005 }) }, () => {
  process.env.GODOT_MCP_LSP_PORT = "6099";
  try {
    assert.deepEqual(
      resolveLspEndpoint(projA),
      { host: "127.0.0.1", port: 6099 },
      "resolve: env port overrides registry",
    );
    process.env.GODOT_MCP_LSP_HOST = "127.0.0.9";
    assert.deepEqual(resolveLspEndpoint(projA), { host: "127.0.0.9", port: 6099 }, "resolve: env host honored");
  } finally {
    delete process.env.GODOT_MCP_LSP_PORT;
    delete process.env.GODOT_MCP_LSP_HOST;
  }
});

// 2. registry hit (no env).
withRegistry({ [keyA]: entry({ lsp_port: 6005 }) }, () => {
  assert.deepEqual(resolveLspEndpoint(projA), { host: "127.0.0.1", port: 6005 }, "resolve: registry hit");
});

// 3. registry conflict → throws LSP_PORT_CONFLICT.
withRegistry(
  {
    [keyA]: entry({ lsp_port: 6005, started_at: 2000, pid: ALIVE }),
    [keyB]: entry({ lsp_port: 6005, started_at: 1000, pid: ALIVE2 }),
  },
  () => {
    assert.throws(
      () => resolveLspEndpoint(projA),
      (e: unknown) => e instanceof LspResolutionError && e.code === "LSP_PORT_CONFLICT",
      "resolve: registry conflict → LSP_PORT_CONFLICT",
    );
  },
);

// 4. miss + 6005 free → 6005.
withRegistry({}, () => {
  assert.deepEqual(resolveLspEndpoint(projA), { host: "127.0.0.1", port: 6005 }, "resolve: miss + free 6005 → 6005");
});

// 5. miss + 6005 held by a LIVE editor → LSP_UNAVAILABLE (no blind fallback).
withRegistry({ [keyB]: entry({ lsp_port: 6005, pid: ALIVE }) }, () => {
  assert.throws(
    () => resolveLspEndpoint(projA),
    (e: unknown) => e instanceof LspResolutionError && e.code === "LSP_UNAVAILABLE",
    "resolve: ambiguous miss → LSP_UNAVAILABLE (no blind 6005)",
  );
});

// 6. miss + 6005 held only by a DEAD editor → 6005 (stale entry ignored).
withRegistry({ [keyB]: entry({ lsp_port: 6005, pid: DEAD }) }, () => {
  assert.deepEqual(
    resolveLspEndpoint(projA),
    { host: "127.0.0.1", port: 6005 },
    "resolve: miss + dead 6005 holder → 6005",
  );
});

// ── getLspStatus (verdict the server reports to the dock) ────────────

// Owner → active, with host/port.
withRegistry({ [keyA]: entry({ lsp_port: 6005, lsp_host: "127.0.0.1" }) }, () => {
  assert.deepEqual(
    getLspStatus(projA),
    { state: "active", host: "127.0.0.1", port: 6005, detail: "Owns the GDScript LSP port." },
    "getLspStatus: owner → active",
  );
});

// Earlier live peer → conflict, carrying the contested port.
withRegistry(
  {
    [keyA]: entry({ lsp_port: 6005, started_at: 2000, pid: ALIVE }),
    [keyB]: entry({ lsp_port: 6005, started_at: 1000, pid: ALIVE2 }),
  },
  () => {
    const s = getLspStatus(projA);
    assert.equal(s.state, "conflict", "getLspStatus: earlier peer → conflict");
    assert.equal(s.port, 6005, "getLspStatus: conflict carries the port");
  },
);

// Ambiguous miss (6005 held by a live editor) → unavailable.
withRegistry({ [keyB]: entry({ lsp_port: 6005, pid: ALIVE }) }, () => {
  const s = getLspStatus(projA);
  assert.equal(s.state, "unavailable", "getLspStatus: ambiguous miss → unavailable");
  assert.equal(s.port, 6005, "getLspStatus: unavailable carries the port");
});

// ── lspConflictHint — version-tailored recovery (via resolveLspEndpoint) ──
// 4.5+ auto-rebinds when the other editor closes; 4.2-4.4 has no LSP bind retry,
// so it must use distinct ports. The hint must offer only the applicable path.

function conflictHint(): string {
  let hint = "";
  withRegistry(
    {
      [keyA]: entry({ lsp_port: 6005, started_at: 2000, pid: ALIVE }),
      [keyB]: entry({ lsp_port: 6005, started_at: 1000, pid: ALIVE2 }),
    },
    () => {
      try {
        resolveLspEndpoint(projA);
      } catch (e) {
        if (e instanceof LspResolutionError) hint = e.hint;
      }
    },
  );
  return hint;
}

setGodotVersionGetter(() => [4, 5]);
{
  const h = conflictHint();
  assert.ok(h.includes("rebinds the port automatically"), "hint(4.5) → offers auto-rebind recovery");
  assert.ok(!h.includes("won't recover"), "hint(4.5) → omits the 4.2-4.4 no-recovery caveat");
}

setGodotVersionGetter(() => [4, 6]);
assert.ok(conflictHint().includes("rebinds the port automatically"), "hint(4.6) → auto-rebind recovery");

setGodotVersionGetter(() => [4, 2]);
{
  const h = conflictHint();
  assert.ok(h.includes("won't recover this LSP without restarting"), "hint(4.2) → distinct-port, no auto-rebind");
  assert.ok(!h.includes("rebinds the port automatically"), "hint(4.2) → omits the 4.5+ auto-rebind claim");
}

setGodotVersionGetter(() => [4, 4]);
assert.ok(
  conflictHint().includes("won't recover this LSP without restarting"),
  "hint(4.4) → distinct-port (4.4 is pre-retry)",
);

setGodotVersionGetter(() => undefined);
{
  const h = conflictHint();
  assert.ok(
    h.includes("4.5+ rebinds automatically") && h.includes("4.2-4.4 restart this editor after"),
    "hint(unknown) → covers both version ranges",
  );
}
setGodotVersionGetter(() => undefined); // reset module-level state

console.log("All discover_lsp tests passed.");
