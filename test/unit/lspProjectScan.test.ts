/**
 * Unit tests for lspProjectScan.ts — the pure enumeration + aggregation seam
 * behind lsp_project_diagnostics. The walk is exercised against a real fixture
 * tree in a tmpdir (cleaned in a finally); the aggregation is exercised with
 * synthetic per-file records, no filesystem or LSP.
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  enumerateGdFiles,
  aggregateScan,
  filterBySeverity,
  type FileScanResult,
} from "../../src/lsp/lspProjectScan.js";
import type { DiagnosticEntry } from "../../src/lsp/lspClient.js";

// ── enumerateGdFiles — walk exclusions ──────────────────────────────
//
// Build a fixture project tree covering every exclusion rule, then assert the
// enumerated set is exactly the expected .gd files (with and without addons).

{
  const root = mkdtempSync(join(tmpdir(), "godot-mcp-scan-"));
  try {
    // Top-level .gd — included.
    writeFileSync(join(root, "top.gd"), "extends Node");

    // Nested normal dir with a .gd — included.
    mkdirSync(join(root, "scripts"));
    writeFileSync(join(root, "scripts", "enemy.gd"), "extends Node");

    // .godot/ dot-dir with a .gd — excluded (dot-dir).
    mkdirSync(join(root, ".godot"));
    writeFileSync(join(root, ".godot", "cache.gd"), "extends Node");

    // addons/ with a .gd — excluded unless includeAddons.
    mkdirSync(join(root, "addons"));
    writeFileSync(join(root, "addons", "plugin.gd"), "extends Node");

    // Dir with a .gdignore + a .gd — excluded (whole subtree).
    mkdirSync(join(root, "vendored"));
    writeFileSync(join(root, "vendored", ".gdignore"), "");
    writeFileSync(join(root, "vendored", "ignored.gd"), "extends Node");

    // Non-.gd files — excluded by extension.
    writeFileSync(join(root, "effect.gdshader"), "shader_type canvas_item;");
    writeFileSync(join(root, "Player.cs"), "public class Player {}");

    // ── includeAddons: false ──
    const withoutAddons = (await enumerateGdFiles(root, { includeAddons: false })).sort();
    assert.deepEqual(withoutAddons, ["res://scripts/enemy.gd", "res://top.gd"]);

    // ── includeAddons: true — superset that adds only the addons .gd ──
    const withAddons = (await enumerateGdFiles(root, { includeAddons: true })).sort();
    assert.deepEqual(withAddons, ["res://addons/plugin.gd", "res://scripts/enemy.gd", "res://top.gd"]);

    // Explicitly assert the excluded files never appear, in either mode.
    for (const set of [withoutAddons, withAddons]) {
      assert.ok(!set.includes("res://.godot/cache.gd"), "dot-dir .gd must be excluded");
      assert.ok(!set.some((p) => p.endsWith("ignored.gd")), ".gdignore subtree must be excluded");
      assert.ok(!set.some((p) => p.endsWith(".gdshader")), "shaders must be excluded");
      assert.ok(!set.some((p) => p.endsWith(".cs")), "C# must be excluded");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ── enumerateGdFiles — a nested addons/ is not special ──────────────
//
// Only the TOP-LEVEL res://addons/ is excluded; foo/addons/bar.gd is ordinary.

{
  const root = mkdtempSync(join(tmpdir(), "godot-mcp-scan-"));
  try {
    mkdirSync(join(root, "game"));
    mkdirSync(join(root, "game", "addons"));
    writeFileSync(join(root, "game", "addons", "nested.gd"), "extends Node");

    const files = await enumerateGdFiles(root, { includeAddons: false });
    assert.deepEqual(files, ["res://game/addons/nested.gd"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ── enumerateGdFiles — empty project yields no files ────────────────

{
  const root = mkdtempSync(join(tmpdir(), "godot-mcp-scan-"));
  try {
    const files = await enumerateGdFiles(root, { includeAddons: true });
    assert.deepEqual(files, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ── filterBySeverity — errors-only vs include-warnings ──────────────

{
  const diags: DiagnosticEntry[] = [
    { line: 0, character: 0, severity: 1, message: "an error" },
    { line: 1, character: 0, severity: 2, message: "a warning" },
    { line: 2, character: 0, severity: 3, message: "info" },
    { line: 3, character: 0, severity: 4, message: "hint" },
  ];

  // include_warnings false → only the Error (severity 1) survives.
  const errorsOnly = filterBySeverity(diags, false);
  assert.equal(errorsOnly.length, 1);
  assert.equal(errorsOnly[0].severity, 1);

  // include_warnings true → all four kept.
  assert.equal(filterBySeverity(diags, true).length, 4);

  // A warnings-only file under errors-only → empty (classifies clean).
  const warningsOnly: DiagnosticEntry[] = [{ line: 0, character: 0, severity: 2, message: "w" }];
  assert.equal(filterBySeverity(warningsOnly, false).length, 0);
  assert.equal(filterBySeverity(warningsOnly, true).length, 1);
}

// ── aggregateScan — bucket counts + invariant + formatting ──────────

{
  const results: FileScanResult[] = [
    { filePath: "res://a.gd", kind: "clean" },
    { filePath: "res://b.gd", kind: "clean" },
    {
      filePath: "res://c.gd",
      kind: "diagnostics",
      diagnostics: [
        { line: 11, character: 4, severity: 1, message: "boom", code: "P123" },
        { line: 20, character: 0, severity: 1, message: "kaboom" },
      ],
    },
    { filePath: "res://d.gd", kind: "timed_out" },
    { filePath: "res://e.gd", kind: "read_failed" },
  ];

  const payload = aggregateScan(results, 10);

  assert.equal(payload.success, true);
  assert.equal(payload.scanned, 5);
  assert.equal(payload.clean, 2);
  assert.equal(payload.files_with_diagnostics.length, 1);
  assert.equal(payload.total_diagnostics, 2);
  assert.deepEqual(payload.timed_out, ["res://d.gd"]);
  assert.deepEqual(payload.read_failed, ["res://e.gd"]);
  assert.ok(typeof payload.note === "string" && payload.note.includes("NOT clean"));

  // The invariant the aggregator asserts internally, re-checked here.
  assert.equal(
    payload.scanned,
    payload.clean +
      payload.files_with_diagnostics.length +
      (payload.timed_out?.length ?? 0) +
      (payload.read_failed?.length ?? 0),
  );

  // Per-diagnostic mapping: 1-based line/character, severity label, code only when present.
  const dirty = payload.files_with_diagnostics[0];
  assert.equal(dirty.file_path, "res://c.gd");
  assert.deepEqual(dirty.diagnostics[0], { line: 12, character: 5, severity: "Error", message: "boom", code: "P123" });
  assert.deepEqual(dirty.diagnostics[1], { line: 21, character: 1, severity: "Error", message: "kaboom" });
  assert.equal("code" in dirty.diagnostics[1], false);
}

// ── aggregateScan — empty timed_out/read_failed/note omitted ────────

{
  const payload = aggregateScan(
    [
      { filePath: "res://a.gd", kind: "clean" },
      {
        filePath: "res://b.gd",
        kind: "diagnostics",
        diagnostics: [{ line: 0, character: 0, severity: 1, message: "e" }],
      },
    ],
    10,
  );
  assert.equal(payload.scanned, 2);
  assert.equal(payload.clean, 1);
  assert.equal("timed_out" in payload, false);
  assert.equal("read_failed" in payload, false);
  assert.equal("note" in payload, false);
}

// ── aggregateScan — zero files → scanned 0, all buckets empty ───────

{
  const payload = aggregateScan([], 10);
  assert.equal(payload.scanned, 0);
  assert.equal(payload.clean, 0);
  assert.equal(payload.files_with_diagnostics.length, 0);
  assert.equal(payload.total_diagnostics, 0);
  assert.equal("timed_out" in payload, false);
}

console.log("All lspProjectScan tests passed.");
