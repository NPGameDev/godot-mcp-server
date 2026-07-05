/**
 * Unit tests for lspUri.ts — pure URI / path translation helpers.
 * Every function is pure (no I/O, no editor), so we assert derived values
 * directly. Results are platform-independent: node:path.join differences
 * are normalized away by absoluteToFileUri before any comparison, so these
 * pass identically on POSIX CI and a Windows dev box.
 */
import assert from "node:assert/strict";
import { resToAbsolute, absoluteToFileUri, fileUriToRes, normalizeUri } from "../../src/lsp/lspUri.js";

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

// ── Round-trip: POSIX project path recovers res:// ──────────────────
//
// res://a/b.gd → absolute → file:// URI → res://a/b.gd, exactly as the
// Windows case above. fileUriToRes detects the non-drive-letter (POSIX)
// form and KEEPS the leading "/", so the project-prefix match succeeds and
// res:// is recovered. (Dropping that leading "/" would break the prefix
// match and wrongly return the raw URI — this pins the keep.)
{
  const project = "/home/proj";
  const abs = resToAbsolute("res://a/b.gd", project);
  const uri = absoluteToFileUri(abs);
  assert.equal(uri, "file:///home/proj/a/b.gd");
  assert.equal(fileUriToRes(uri, project), "res://a/b.gd");
}

// ── fileUriToRes: POSIX in-project absolute URI with a subfolder ─────
//
// A Mac/Linux absolute path under the project recovers its res:// path
// (direct regression: POSIX file URI round-trip with a subfolder).
{
  assert.equal(fileUriToRes("file:///home/proj/sub/x.gd", "/home/proj"), "res://sub/x.gd");
}

// ── fileUriToRes: Windows in-project URI with a %3A-encoded drive colon ──
//
// Godot's LSP percent-encodes the Windows drive colon (file:///C%3A/…). The
// %3A must decode to ":" BEFORE the drive-letter test, or the spurious leading
// slash survives, the project-prefix match fails, and a raw file:// URI leaks
// for an in-project file. Asserts the res:// contract holds for the %3A form
// (the literal-colon file:///C:/ form is already covered by the round-trip).
{
  assert.equal(fileUriToRes("file:///C%3A/Users/me/project/sub/x.gd", "C:\\Users\\me\\project"), "res://sub/x.gd");
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
