/**
 * System-wide project registry reader (iter 23).
 *
 * Mirrors the GDScript `registry_client.gd` — same file, same schema, same
 * path normalisation. The plugin writes; this module reads.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// -- Types -------------------------------------------------------------------

export interface RegistryEntry {
  port: number;
  token_path: string;
  pid: number;
  started_at: number;
  runtime_port: number | null;
  runtime_pid: number | null;
}

interface Registry {
  by_path: Record<string, RegistryEntry>;
}

// -- Path helpers ------------------------------------------------------------

/** Canonical path form: forward slashes, no trailing slash. */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

/** OS-specific registry file path — must match registry_client.gd. */
export function registryPath(): string {
  switch (process.platform) {
    case "win32":
      return join(
        process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"),
        "godot-mcp-toolkit",
        "projects.json",
      );
    case "darwin":
      return join(
        homedir(),
        "Library",
        "Application Support",
        "godot-mcp-toolkit",
        "projects.json",
      );
    default:
      return join(
        process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"),
        "godot-mcp-toolkit",
        "projects.json",
      );
  }
}

// -- Registry I/O ------------------------------------------------------------

function readRegistry(): Registry {
  try {
    const data = JSON.parse(readFileSync(registryPath(), "utf-8")) as Registry;
    if (data && typeof data.by_path === "object") return data;
    return { by_path: {} };
  } catch {
    return { by_path: {} };
  }
}

/**
 * Look up a project by its absolute path. Returns the entry or null.
 * The path is normalised before lookup (backslashes → forward slashes,
 * trailing slash stripped) so Windows CWD and GDScript registry keys match.
 */
export function lookupProject(projectPath: string): RegistryEntry | null {
  const key = normalizePath(projectPath);
  const registry = readRegistry();
  return registry.by_path[key] ?? null;
}

/**
 * Return the runtime_port for a project, or null if no playtest is active.
 * Re-reads the file on every call so newly-started playtests are picked up.
 */
export function discoverRuntime(projectPath: string): number | null {
  const entry = lookupProject(projectPath);
  if (!entry) return null;
  return entry.runtime_port ?? null;
}
