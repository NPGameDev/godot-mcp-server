/**
 * Unit tests for portConfig.ts — the shared CLI > env > discovery > default
 * resolver.
 *
 * Fixes the per-channel precedence contract: the editor channel resolves to a
 * concrete port with a `pinned` flag and a source tag; the runtime and LSP
 * channels resolve a pin only (undefined = lazy discovery). Registry-backed cases
 * (discovery / default) redirect the registry root into a temp dir — skipped on
 * darwin, which has no registry-path override (mirrors bridge-rediscover).
 */
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { snapshotEnv } from "./helpers.js";
import { normalizePath, registryPath, type RegistryEntry } from "../../src/registry.js";
import { resolvePortConfig, isValidPort, PortConfigError } from "../../src/startup/portConfig.js";
import type { CliArgs } from "../../src/startup/cliArgs.js";

const REDIRECT: string | null =
  process.platform === "win32" ? "APPDATA" : process.platform === "linux" ? "XDG_DATA_HOME" : null;

function noCli(over: Partial<CliArgs> = {}): CliArgs {
  return { help: false, toolsCount: false, ...over };
}

function clearPortEnv(): void {
  delete process.env.GODOT_MCP_EDITOR_PORT;
  delete process.env.GODOT_MCP_RUNTIME_PORT;
  delete process.env.GODOT_MCP_LSP_PORT;
  delete process.env.GODOT_MCP_LSP_HOST;
}

// ── Editor: CLI pin wins over env ────────────────────────────────────
{
  const restore = snapshotEnv();
  try {
    clearPortEnv();
    process.env.GODOT_MCP_EDITOR_PORT = "7000"; // present, but CLI must win
    const cfg = resolvePortConfig(noCli({ editorPort: "8000" }), "/x");
    assert.equal(cfg.editorPort, "8000");
    assert.equal(cfg.editorPinned, true);
    assert.equal(cfg.editorSource, "cli");
  } finally {
    restore();
  }
}

// ── Editor: env pin when no CLI (still pinned, skips discovery) ───────
{
  const restore = snapshotEnv();
  try {
    clearPortEnv();
    process.env.GODOT_MCP_EDITOR_PORT = "7000";
    const cfg = resolvePortConfig(noCli(), "/x");
    assert.equal(cfg.editorPort, "7000");
    assert.equal(cfg.editorPinned, true);
    assert.equal(cfg.editorSource, "env");
  } finally {
    restore();
  }
}

// ── Runtime: CLI > env > undefined(lazy) ─────────────────────────────
{
  const restore = snapshotEnv();
  try {
    clearPortEnv();
    process.env.GODOT_MCP_RUNTIME_PORT = "6580";
    let cfg = resolvePortConfig(noCli({ runtimePort: "6599" }), "/x");
    assert.equal(cfg.runtimePort, "6599");
    assert.equal(cfg.runtimeSource, "cli");

    cfg = resolvePortConfig(noCli(), "/x");
    assert.equal(cfg.runtimePort, "6580");
    assert.equal(cfg.runtimeSource, "env");

    delete process.env.GODOT_MCP_RUNTIME_PORT;
    cfg = resolvePortConfig(noCli(), "/x");
    assert.equal(cfg.runtimePort, undefined, "no pin → lazy discovery");
    assert.equal(cfg.runtimeSource, "discovery");
  } finally {
    restore();
  }
}

// ── LSP: CLI > env > undefined(lazy), host tags along ────────────────
{
  const restore = snapshotEnv();
  try {
    clearPortEnv();
    process.env.GODOT_MCP_LSP_PORT = "6099";
    process.env.GODOT_MCP_LSP_HOST = "10.0.0.1";
    let cfg = resolvePortConfig(noCli({ lspPort: "7099", lspHost: "10.0.0.2" }), "/x");
    assert.equal(cfg.lspPort, "7099");
    assert.equal(cfg.lspHost, "10.0.0.2");
    assert.equal(cfg.lspSource, "cli");

    cfg = resolvePortConfig(noCli(), "/x");
    assert.equal(cfg.lspPort, "6099");
    assert.equal(cfg.lspHost, "10.0.0.1");
    assert.equal(cfg.lspSource, "env");

    delete process.env.GODOT_MCP_LSP_PORT;
    delete process.env.GODOT_MCP_LSP_HOST;
    cfg = resolvePortConfig(noCli(), "/x");
    assert.equal(cfg.lspPort, undefined);
    assert.equal(cfg.lspHost, undefined);
    assert.equal(cfg.lspSource, "discovery");
  } finally {
    restore();
  }
}

// ── Editor: registry discovery when no pin (REDIRECT only) ───────────
if (REDIRECT) {
  const restore = snapshotEnv();
  const tmp = mkdtempSync(join(tmpdir(), "mcp-portcfg-"));
  try {
    clearPortEnv();
    process.env[REDIRECT] = tmp;
    const projectPath = "/__portcfg_unit__/discovery";
    const entry: RegistryEntry = {
      port: 6612,
      token_path: "t",
      pid: process.pid,
      started_at: 1,
      runtime_port: null,
      runtime_pid: null,
    };
    mkdirSync(dirname(registryPath()), { recursive: true });
    writeFileSync(registryPath(), JSON.stringify({ by_path: { [normalizePath(projectPath)]: entry } }));
    const cfg = resolvePortConfig(noCli(), projectPath);
    assert.equal(cfg.editorPort, "6612");
    assert.equal(cfg.editorPinned, false, "a discovered port is not a pin");
    assert.equal(cfg.editorSource, "discovery");
  } finally {
    restore();
    rmSync(tmp, { recursive: true, force: true });
  }
} else {
  console.log("  SKIP (no registry redirect on this platform): editor discovery");
}

// ── Editor: default 6550 when no pin + no registry entry (REDIRECT) ──
if (REDIRECT) {
  const restore = snapshotEnv();
  const tmp = mkdtempSync(join(tmpdir(), "mcp-portcfg-"));
  try {
    clearPortEnv();
    process.env[REDIRECT] = tmp; // empty dir → no projects.json → no entry
    const cfg = resolvePortConfig(noCli(), "/__portcfg_unit__/absent");
    assert.equal(cfg.editorPort, "6550");
    assert.equal(cfg.editorPinned, false);
    assert.equal(cfg.editorSource, "default");
  } finally {
    restore();
    rmSync(tmp, { recursive: true, force: true });
  }
} else {
  console.log("  SKIP (no registry redirect on this platform): editor default");
}

// ── isValidPort — the shared pin predicate ───────────────────────────
{
  for (const good of ["1", "6550", "65535", "08080"]) {
    assert.equal(isValidPort(good), true, `isValidPort accepts "${good}"`);
  }
  for (const bad of ["0", "65536", "99999", "abc", "6550.5", "-1", "+6550", "", "6550abc"]) {
    assert.equal(isValidPort(bad), false, `isValidPort rejects "${bad}"`);
  }
}

// ── Pin validation: invalid effective pins throw PortConfigError ─────
// The error names the exact source the user typed (flag vs env var) and the
// offending value, so the startup exit line is directly fixable.
{
  const restore = snapshotEnv();
  try {
    clearPortEnv();

    // CLI editor pin, non-numeric.
    assert.throws(
      () => resolvePortConfig(noCli({ editorPort: "abc" }), "/x"),
      (err: unknown) =>
        err instanceof PortConfigError && err.message.includes("--editor-port") && err.message.includes('"abc"'),
      "--editor-port abc → PortConfigError naming the flag and value",
    );

    // Env editor pin, port 0 (a pin must name an exact port).
    process.env.GODOT_MCP_EDITOR_PORT = "0";
    assert.throws(
      () => resolvePortConfig(noCli(), "/x"),
      (err: unknown) =>
        err instanceof PortConfigError && err.message.includes("GODOT_MCP_EDITOR_PORT") && err.message.includes('"0"'),
      "GODOT_MCP_EDITOR_PORT=0 → PortConfigError naming the env var",
    );
    delete process.env.GODOT_MCP_EDITOR_PORT;

    // CLI runtime pin, out of range.
    assert.throws(
      () => resolvePortConfig(noCli({ runtimePort: "99999" }), "/x"),
      (err: unknown) =>
        err instanceof PortConfigError && err.message.includes("--runtime-port") && err.message.includes('"99999"'),
      "--runtime-port 99999 → PortConfigError (out of range)",
    );

    // Env runtime pin, above the ceiling.
    process.env.GODOT_MCP_RUNTIME_PORT = "65536";
    assert.throws(
      () => resolvePortConfig(noCli(), "/x"),
      (err: unknown) => err instanceof PortConfigError && err.message.includes("GODOT_MCP_RUNTIME_PORT"),
      "GODOT_MCP_RUNTIME_PORT=65536 → PortConfigError",
    );
    delete process.env.GODOT_MCP_RUNTIME_PORT;

    // Env LSP pin, non-integer.
    process.env.GODOT_MCP_LSP_PORT = "6005.5";
    assert.throws(
      () => resolvePortConfig(noCli(), "/x"),
      (err: unknown) => err instanceof PortConfigError && err.message.includes("GODOT_MCP_LSP_PORT"),
      "GODOT_MCP_LSP_PORT=6005.5 → PortConfigError (not an integer)",
    );
    delete process.env.GODOT_MCP_LSP_PORT;

    // CLI wins → a shadowed invalid env value is NOT validated (precedence
    // selects the effective value; only that value must be usable).
    process.env.GODOT_MCP_EDITOR_PORT = "abc";
    const cfg = resolvePortConfig(noCli({ editorPort: "8000" }), "/x");
    assert.equal(cfg.editorPort, "8000", "a valid CLI pin shadows an invalid env value without erroring");
  } finally {
    restore();
  }
}

// ── Pin validation: boundary values pass ─────────────────────────────
{
  const restore = snapshotEnv();
  try {
    clearPortEnv();
    for (const boundary of ["1", "65535"]) {
      const cfg = resolvePortConfig(noCli({ editorPort: boundary }), "/x");
      assert.equal(cfg.editorPort, boundary, `boundary port ${boundary} is accepted`);
      assert.equal(cfg.editorPinned, true);
    }
  } finally {
    restore();
  }
}

console.log("All portConfig tests passed.");
