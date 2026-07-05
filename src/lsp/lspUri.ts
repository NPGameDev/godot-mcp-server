/**
 * Pure URI / path translation between Godot's `res://` virtual paths and
 * `file://` URIs (and back), plus URI normalization for diagnostics map
 * lookups. Leaf module — zero project dependencies; shared by the LSP tool
 * layer and the LSP client.
 */
import { join } from "node:path";

/** Translate a `res://` virtual path to an absolute filesystem path under the project root. */
export function resToAbsolute(resPath: string, projectPath: string): string {
  // res://foo/bar.gd → <projectPath>/foo/bar.gd
  const relative = resPath.replace(/^res:\/\//, "");
  return join(projectPath, relative);
}

/** Convert an absolute filesystem path to a `file://` URI (drive-letter and POSIX forms). */
export function absoluteToFileUri(absPath: string): string {
  // Windows: C:\foo\bar.gd → file:///C:/foo/bar.gd
  // Unix: /foo/bar.gd → file:///foo/bar.gd
  const normalized = absPath.replace(/\\/g, "/");
  if (/^[A-Za-z]:/.test(normalized)) {
    return `file:///${normalized}`;
  }
  return `file://${normalized}`;
}

/** Map a `file://` URI back to a `res://` path when it falls inside the project; return the input unchanged otherwise. */
export function fileUriToRes(uri: string, projectPath: string): string {
  // file:///C:/project/foo.gd → res://foo.gd  (Windows)
  // file:///home/project/foo.gd → res://foo.gd  (POSIX)
  if (!uri.startsWith("file://")) {
    return uri; // Not a file URI, return as-is.
  }
  let absPath = uri.slice(7); // Strip "file://"; a drive form keeps a leading "/".

  // Decode percent-encoding BEFORE the drive-letter test below. Godot's LSP
  // emits the Windows drive colon as %3A (file:///C%3A/…); decoding first
  // makes it a literal ":" so the `/<letter>:` drive form is recognized.
  // Testing the still-encoded URI would miss %3A, keep the spurious leading
  // slash, and break the project-prefix match — leaking a raw file:// URI for
  // an in-project file.
  absPath = decodeURIComponent(absPath);

  // A Windows drive-letter URI (file:///C:/…) carries a leading slash that a
  // POSIX URI (file:///home/…) MUST keep — or the project-prefix test below
  // never matches — but the drive form must shed. Drop it only for the drive
  // form; host-independent, so the same URI converts identically on Windows
  // and POSIX.
  if (/^\/[A-Za-z]:/.test(absPath)) {
    absPath = absPath.slice(1);
  }

  // Normalize slashes.
  const normalizedProject = projectPath.replace(/\\/g, "/").replace(/\/$/, "");
  const normalizedPath = absPath.replace(/\\/g, "/");

  // Strip project prefix to get res:// path.
  if (normalizedPath.toLowerCase().startsWith(normalizedProject.toLowerCase())) {
    const relative = normalizedPath.slice(normalizedProject.length);
    return "res:/" + relative; // normalizedPath starts with / after project path
  }

  return uri; // Outside project — return raw.
}

/**
 * Normalize a file URI for map lookups. Godot's LSP may return URIs
 * with different drive-letter casing or percent-encoding than we send.
 */
export function normalizeUri(uri: string): string {
  let norm = decodeURIComponent(uri).replace(/\\/g, "/");
  // Lowercase Windows drive letter: file:///C: → file:///c:
  if (/^file:\/\/\/[A-Z]:/.test(norm)) {
    norm = "file:///" + norm[8].toLowerCase() + norm.slice(9);
  }
  return norm;
}
