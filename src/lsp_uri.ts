/**
 * Pure URI / path translation between Godot's `res://` virtual paths and
 * `file://` URIs (and back), plus URI normalization for diagnostics map
 * lookups. Leaf module — zero project dependencies; shared by the LSP tool
 * layer (`tools/lsp.ts`) and the LSP client (`lsp_client.ts`).
 */
import { join } from "node:path";

export function resToAbsolute(resPath: string, projectPath: string): string {
  // res://foo/bar.gd → <projectPath>/foo/bar.gd
  const relative = resPath.replace(/^res:\/\//, "");
  return join(projectPath, relative);
}

export function absoluteToFileUri(absPath: string): string {
  // Windows: C:\foo\bar.gd → file:///C:/foo/bar.gd
  // Unix: /foo/bar.gd → file:///foo/bar.gd
  const normalized = absPath.replace(/\\/g, "/");
  if (/^[A-Za-z]:/.test(normalized)) {
    return `file:///${normalized}`;
  }
  return `file://${normalized}`;
}

export function fileUriToRes(uri: string, projectPath: string): string {
  // file:///C:/project/foo.gd → res://foo.gd
  let absPath: string;
  if (uri.startsWith("file:///")) {
    absPath = uri.slice(8); // Remove file:///
  } else if (uri.startsWith("file://")) {
    absPath = uri.slice(7); // Remove file://
  } else {
    return uri; // Not a file URI, return as-is.
  }

  // Decode percent-encoding.
  absPath = decodeURIComponent(absPath);

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
