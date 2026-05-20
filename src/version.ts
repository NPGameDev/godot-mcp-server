import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ── Server version (single source of truth: package.json) ───────────

const __dirname = dirname(fileURLToPath(import.meta.url));

let cachedVersion: string | null = null;

/** Read the server version from package.json. Cached after first call. */
export function getServerVersion(): string {
  if (cachedVersion) return cachedVersion;
  try {
    // In dist/, package.json is one level up.
    const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8")) as {
      version?: string;
    };
    cachedVersion = pkg.version ?? "0.0.0";
  } catch {
    cachedVersion = "0.0.0";
  }
  return cachedVersion;
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
 *   "unknown" — remote is undefined/null/empty (pre-handshake peer)
 */
export function compareVersions(local: string, remote: string | undefined | null): VersionSeverity {
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
