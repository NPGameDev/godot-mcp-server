/**
 * Version utilities — the server's own version (read from package.json) and the
 * Godot version-gating helpers. {@link GodotVer} is the parsed `[major, minor]`
 * tuple the tool-version gate compares against; the rest parse, compare, and
 * bound-check engine versions for the registration-time and per-call gates, plus
 * a semver severity compare for the auth-handshake version check.
 *
 * @module
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ── Server version (single source of truth: package.json) ───────────

const __dirname = dirname(fileURLToPath(import.meta.url));

let cachedVersion: string | undefined = undefined;

/** Read the server version from package.json. Cached after first call. */
export function getServerVersion(): string {
  if (cachedVersion) return cachedVersion;
  try {
    // package.json lives at the package root — two levels up from this module's
    // home (dist/shared/version.js when built; src/shared/version.ts under tsx).
    const pkg = JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf-8")) as {
      version?: string;
    };
    cachedVersion = pkg.version ?? "0.0.0";
  } catch {
    cachedVersion = "0.0.0";
  }
  return cachedVersion;
}

// ── Godot version gating ────────────────────────────────────────────

/** Parsed Godot version as [major, minor] tuple. */
export type GodotVer = [major: number, minor: number];

/** Parse a "major.minor" or "major.minor.patch" string to a [major, minor] tuple. */
export function parseGodotVer(v: string): GodotVer {
  const parts = v.split(".").map(Number);
  return [parts[0] ?? 0, parts[1] ?? 0];
}

/** Compare two GodotVer tuples. Returns negative/0/positive like strcmp. */
export function compareGodotVer(a: GodotVer, b: GodotVer): number {
  if (a[0] !== b[0]) return a[0] - b[0];
  return a[1] - b[1];
}

/** Check whether a connected Godot version is >= the given minimum. */
export function isVersionAtLeast(connected: GodotVer, min: string): boolean {
  return compareGodotVer(connected, parseGodotVer(min)) >= 0;
}

/** Check whether a connected Godot version is <= the given maximum. */
export function isVersionAtMost(connected: GodotVer, max: string): boolean {
  return compareGodotVer(connected, parseGodotVer(max)) <= 0;
}

/** Check whether a connected Godot version falls within [min, max] bounds (each bound optional, inclusive). */
export function isVersionCompatible(connected: GodotVer, min?: string, max?: string): boolean {
  if (min != null && !isVersionAtLeast(connected, min)) return false;
  if (max != null && !isVersionAtMost(connected, max)) return false;
  return true;
}

// ── Version comparison ──────────────────────────────────────────────

export type VersionSeverity = "ok" | "minor" | "major" | "unknown";

/**
 * Compare two semver version strings.
 *
 * Returns:
 *   "ok"      — versions match (all components equal)
 *   "minor"   — same major, different minor or patch
 *   "major"   — different major version
 *   "unknown" — remote is undefined/empty (pre-handshake peer)
 */
export function compareVersions(local: string, remote: string | undefined): VersionSeverity {
  if (remote == null || remote === "") return "unknown";
  const localParts = local.split(".").map(Number);
  const remoteParts = remote.split(".").map(Number);
  if (localParts.length !== 3 || remoteParts.length !== 3) return "unknown";
  if (localParts.some((n) => !Number.isFinite(n)) || remoteParts.some((n) => !Number.isFinite(n))) {
    return "unknown";
  }
  if (localParts[0] !== remoteParts[0]) return "major";
  if (localParts[1] !== remoteParts[1] || localParts[2] !== remoteParts[2]) return "minor";
  return "ok";
}
