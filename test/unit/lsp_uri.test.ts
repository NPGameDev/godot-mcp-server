/**
 * Unit tests for lsp_uri.ts — pure URI / path translation helpers.
 * Every function is pure (no I/O, no editor), so we assert derived values
 * directly. Results are platform-independent: node:path.join differences
 * are normalized away by absoluteToFileUri before any comparison, so these
 * pass identically on POSIX CI and a Windows dev box.
 */
import assert from "node:assert/strict";
import { resToAbsolute, absoluteToFileUri, fileUriToRes, normalizeUri } from "../../src/lsp_uri.js";

// ── Round-trip: Windows project path recovers res:// ────────────────
//
// res://a/b.gd → absolute → file:// URI → res://a/b.gd. A drive-letter
// project round-trips exactly through all three conversions.
{
  const project = "C:\\proj";
  const abs = resToAbsolute("res://a/b.gd", project);
  const uri = absoluteToFileUri(abs);
  assert.equal(uri, "file:///C:/proj/a/b.gd");
  assert.equal(fileUriToRes(uri, project), "res://a/b.gd");
}

// ── Round-trip: POSIX project path returns the raw URI ──────────────
//
// On a POSIX project, absoluteToFileUri emits file:///home/... and
// fileUriToRes's slice(8) drops the leading "/", so the project-prefix
// match fails and the URI is returned unchanged. This documents the
// verbatim (pre-existing) behavior — POSIX paths do NOT recover res://.
{
  const project = "/home/proj";
  const abs = resToAbsolute("res://a/b.gd", project);
  const uri = absoluteToFileUri(abs);
  assert.equal(uri, "file:///home/proj/a/b.gd");
  assert.equal(fileUriToRes(uri, project), "file:///home/proj/a/b.gd");
}

// ── fileUriToRes: file URI outside the project → returned unchanged ──
{
  assert.equal(fileUriToRes("file:///D:/other/x.gd", "C:\\proj"), "file:///D:/other/x.gd");
  assert.equal(fileUriToRes("file:///var/other/x.gd", "/home/proj"), "file:///var/other/x.gd");
}

// ── normalizeUri: lowercases drive letter + decodes %20 ─────────────
{
  assert.equal(normalizeUri("file:///C:/My%20Proj/a.gd"), "file:///c:/My Proj/a.gd");
}

console.log("All lsp_uri tests passed.");
