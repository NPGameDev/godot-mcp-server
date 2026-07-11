/**
 * Project-wide GDScript enumeration + scan-result aggregation for the
 * `lsp_project_diagnostics` tool. Two separable concerns kept apart so the
 * shaping is unit-testable without a filesystem or a live LSP:
 *
 *   1. {@link enumerateGdFiles} — a `node:fs` recursive walk that lists the
 *      `.gd` files the Godot editor would index. A disk walk (not `asset.list`)
 *      is deliberate: the LSP subsystem is bridge-free, and a walk also sees
 *      just-written files the EditorFileSystem has not rescanned yet.
 *   2. {@link aggregateScan} — folds per-file classification records into the
 *      compact response payload and asserts the scan invariant.
 *
 * @module
 */
import { readdir } from "node:fs/promises";
import { join } from "node:path";

import type { DiagnosticEntry } from "./lspClient.js";
import { formatDiagnostic, type FormattedDiagnostic } from "./lspLabels.js";

// LSP diagnostic severity 1 = Error (2 = Warning, 3 = Information, 4 = Hint).
// The errors-only default keeps a file with only warnings classified as clean.
const SEVERITY_ERROR = 1;

// ── File enumeration ───────────────────────────────────────────────────

/**
 * List every `.gd` file under `projectRoot` that Godot's editor would index,
 * as `res://`-relative paths. Pure I/O — no LSP, no bridge.
 *
 * Exclusions mirror the engine's own indexing so the scan targets exactly the
 * files the LSP can compile:
 * - `.gd` only — shaders (no real LSP diagnostics) and `.cs` (external
 *   toolchain) are skipped.
 * - Dot-directories (`.godot/`, `.git/`, `.import/`, …) — never indexed.
 * - Any directory holding a `.gdignore` file — engine parity
 *   (`EditorFileSystem` skips these subtrees).
 * - The top-level `res://addons/` unless `includeAddons` is true (a nested
 *   `foo/addons/` is not special).
 * - Symlinked/junction directory entries — not followed (avoids cycles and
 *   walking outside the project).
 *
 * @param projectRoot absolute path to the Godot project root
 * @param opts.includeAddons also scan the top-level `res://addons/` subtree
 * @returns deduplicated `res://`-relative paths, order-insensitive
 */
export async function enumerateGdFiles(projectRoot: string, opts: { includeAddons: boolean }): Promise<string[]> {
  const found = new Set<string>();
  await walkDir(projectRoot, "", found, opts.includeAddons, true);
  return [...found];
}

/**
 * Recurse one directory, appending discovered `.gd` files to `found`.
 * `relPrefix` is the `res://`-relative path of `dirAbs` (empty at the root).
 * `atRoot` marks the project root so the `addons/` exclusion applies only to
 * the top-level directory.
 */
async function walkDir(
  dirAbs: string,
  relPrefix: string,
  found: Set<string>,
  includeAddons: boolean,
  atRoot: boolean,
): Promise<void> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dirAbs, { withFileTypes: true });
  } catch {
    // An unreadable directory (permissions, vanished mid-walk) contributes no
    // files — the scan continues rather than failing wholesale.
    return;
  }

  // A `.gdignore` anywhere in this directory excludes the whole subtree, per
  // EditorFileSystem — so decide before descending into any child.
  if (entries.some((e) => e.isFile() && e.name === ".gdignore")) return;

  for (const entry of entries) {
    const name = entry.name;
    const rel = relPrefix ? `${relPrefix}/${name}` : name;

    if (entry.isDirectory()) {
      if (name.startsWith(".")) continue; // .godot/, .git/, .import/, …
      if (atRoot && name === "addons" && !includeAddons) continue;
      await walkDir(join(dirAbs, name), rel, found, includeAddons, false);
    } else if (entry.isFile()) {
      // Shaders (.gdshader/.gdshaderinc) and .cs are intentionally excluded —
      // the LSP produces no real diagnostics for them.
      if (name.endsWith(".gd")) found.add(`res://${rel}`);
    }
    // Symlink/junction dirents fall through here: isDirectory()/isFile() are
    // both false for a symlink Dirent (withFileTypes does not stat-follow), so
    // they are skipped without a stat that would follow the link.
  }
}

// ── Result aggregation ─────────────────────────────────────────────────

/** How a single scanned file resolved after its diagnostics wait. */
export type FileScanResult =
  | { filePath: string; kind: "clean" }
  | { filePath: string; kind: "diagnostics"; diagnostics: DiagnosticEntry[] }
  | { filePath: string; kind: "timed_out" }
  | { filePath: string; kind: "read_failed" };

/** A dirty file in the response payload — its `res://` path and formatted diagnostics. */
type FileWithDiagnostics = {
  file_path: string;
  diagnostics: FormattedDiagnostic[];
};

/** The compact `lsp_project_diagnostics` response payload. */
export type ProjectScanPayload = {
  success: true;
  scanned: number;
  clean: number;
  files_with_diagnostics: FileWithDiagnostics[];
  total_diagnostics: number;
  timed_out?: string[];
  read_failed?: string[];
  note?: string;
};

/**
 * Fold per-file scan results into the compact response payload.
 *
 * Classification is already decided per file (the caller applied the
 * `include_warnings` filter before building each record, so a `diagnostics`
 * record here is non-empty and non-clean by construction). This function only
 * counts and shapes: `clean` counts clean files, dirty files carry their
 * mapped diagnostics, and `timed_out`/`read_failed` collect their paths.
 *
 * @returns the payload with empty `timed_out`/`read_failed`/`note` omitted
 * @throws Error if the scan invariant
 *   `scanned === clean + files_with_diagnostics.length + timed_out.length + read_failed.length`
 *   does not hold — a programming error in the caller's bookkeeping
 */
export function aggregateScan(results: FileScanResult[], timeoutSeconds: number): ProjectScanPayload {
  const filesWithDiagnostics: FileWithDiagnostics[] = [];
  const timedOut: string[] = [];
  const readFailed: string[] = [];
  let clean = 0;
  let totalDiagnostics = 0;

  for (const r of results) {
    switch (r.kind) {
      case "clean":
        clean++;
        break;
      case "diagnostics":
        filesWithDiagnostics.push({ file_path: r.filePath, diagnostics: r.diagnostics.map(formatDiagnostic) });
        totalDiagnostics += r.diagnostics.length;
        break;
      case "timed_out":
        timedOut.push(r.filePath);
        break;
      case "read_failed":
        readFailed.push(r.filePath);
        break;
    }
  }

  const scanned = results.length;
  const accounted = clean + filesWithDiagnostics.length + timedOut.length + readFailed.length;
  if (scanned !== accounted) {
    throw new Error(`project scan invariant violated: scanned ${scanned} != accounted ${accounted}`);
  }

  const payload: ProjectScanPayload = {
    success: true,
    scanned,
    clean,
    files_with_diagnostics: filesWithDiagnostics,
    total_diagnostics: totalDiagnostics,
  };
  if (timedOut.length > 0) {
    payload.timed_out = timedOut;
    payload.note = `${timedOut.length} file(s) produced no diagnostics notification within ${timeoutSeconds}s — status unknown, NOT clean.`;
  }
  if (readFailed.length > 0) payload.read_failed = readFailed;
  return payload;
}

/**
 * Keep only Error-severity diagnostics when warnings are not requested.
 * A file left with zero entries after this filter classifies as clean.
 *
 * @param diagnostics the raw diagnostics for one file
 * @param includeWarnings when false, drop Warning/Info/Hint (severity > 1)
 */
export function filterBySeverity(diagnostics: DiagnosticEntry[], includeWarnings: boolean): DiagnosticEntry[] {
  if (includeWarnings) return diagnostics;
  return diagnostics.filter((d) => d.severity === SEVERITY_ERROR);
}
