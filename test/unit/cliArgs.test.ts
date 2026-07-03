/**
 * Unit tests for cliArgs.ts — the hand-rolled argv parser.
 *
 * Fixes the collect-only contract: both flag forms populate the struct, unknown
 * flags / stray positionals / missing values set `error` (fail-loud), and the two
 * boolean gates (`--help`, `--tools-count`) are detected — the latter even when it
 * follows a bad flag. The parser does no port validation (the resolver's job).
 */
import assert from "node:assert/strict";
import { parseCliArgs, formatHelp } from "../../src/startup/cliArgs.js";

// ── Empty argv → all clean, no gates, no error ───────────────────────
{
  const a = parseCliArgs([]);
  assert.equal(a.help, false);
  assert.equal(a.toolsCount, false);
  assert.equal(a.error, undefined);
  assert.equal(a.editorPort, undefined);
  assert.equal(a.runtimePort, undefined);
  assert.equal(a.lspPort, undefined);
  assert.equal(a.lspHost, undefined);
}

// ── Space form: --flag value ─────────────────────────────────────────
{
  const a = parseCliArgs([
    "--editor-port",
    "6557",
    "--runtime-port",
    "6580",
    "--lsp-port",
    "6099",
    "--lsp-host",
    "127.0.0.2",
  ]);
  assert.equal(a.editorPort, "6557");
  assert.equal(a.runtimePort, "6580");
  assert.equal(a.lspPort, "6099");
  assert.equal(a.lspHost, "127.0.0.2");
  assert.equal(a.error, undefined);
}

// ── Equals form: --flag=value ────────────────────────────────────────
{
  const a = parseCliArgs(["--editor-port=6557", "--lsp-host=localhost"]);
  assert.equal(a.editorPort, "6557");
  assert.equal(a.lspHost, "localhost");
  assert.equal(a.error, undefined);
}

// ── Mixed forms in one line ──────────────────────────────────────────
{
  const a = parseCliArgs(["--editor-port=6557", "--runtime-port", "6580"]);
  assert.equal(a.editorPort, "6557");
  assert.equal(a.runtimePort, "6580");
  assert.equal(a.error, undefined);
}

// ── Boolean gates ────────────────────────────────────────────────────
{
  const a = parseCliArgs(["--help"]);
  assert.equal(a.help, true);
  assert.equal(a.error, undefined);
}
{
  const a = parseCliArgs(["--tools-count"]);
  assert.equal(a.toolsCount, true);
  assert.equal(a.error, undefined);
}

// ── Unknown flag → error, but --help after it is still detected ──────
{
  const a = parseCliArgs(["--bogus"]);
  assert.ok(a.error?.includes("unknown flag"));
  assert.ok(a.error?.includes("--bogus"));
}
{
  const a = parseCliArgs(["--bogus", "--help"]);
  assert.equal(a.help, true, "--help is detected even after a bad flag");
  assert.ok(a.error?.includes("unknown flag"), "the earlier unknown flag is still recorded");
}

// ── Missing value: value flag at end of argv ─────────────────────────
{
  const a = parseCliArgs(["--editor-port"]);
  assert.ok(a.error?.includes("missing value"));
  assert.ok(a.error?.includes("--editor-port"));
  assert.equal(a.editorPort, undefined);
}

// ── Missing value: a value flag followed by another flag ─────────────
{
  const a = parseCliArgs(["--editor-port", "--runtime-port", "6580"]);
  assert.ok(a.error?.includes("missing value"), "--runtime-port is the next flag, not a value");
  assert.equal(a.editorPort, undefined);
  assert.equal(a.runtimePort, "6580", "the following flag still parses normally");
}

// ── Missing value: empty inline value ────────────────────────────────
{
  const a = parseCliArgs(["--editor-port="]);
  assert.ok(a.error?.includes("missing value"));
  assert.equal(a.editorPort, undefined);
}

// ── Stray positional → error (no positionals accepted) ───────────────
{
  const a = parseCliArgs(["6557"]);
  assert.ok(a.error?.includes("unexpected argument"));
}

// ── First error wins ─────────────────────────────────────────────────
{
  const a = parseCliArgs(["--bogus", "--alsobad"]);
  assert.ok(a.error?.includes("--bogus"), "the first parse error is kept");
}

// ── formatHelp is stable and lists every flag incl. --tools-count ────
{
  const help = formatHelp();
  for (const flag of ["--editor-port", "--runtime-port", "--lsp-port", "--lsp-host", "--tools-count", "--help"]) {
    assert.ok(help.includes(flag), `help lists ${flag}`);
  }
  assert.ok(help.includes("GODOT_MCP_EDITOR_PORT"), "help maps each flag to its env var");
}

console.log("All cliArgs tests passed.");
