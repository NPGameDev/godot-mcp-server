/**
 * System-wide project registry reader.
 *
 * Mirrors the GDScript `registry_client.gd` — same file, same schema, same
 * path normalisation. The plugin writes; this module reads.
 */

import { readFileSync, watch, statSync } from "node:fs";
import type { FSWatcher } from "node:fs";
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

/** Canonical path form: forward slashes, no trailing slash, lowercase on Windows. */
export function normalizePath(p: string): string {
  let n = p.replace(/\\/g, "/").replace(/\/+$/, "");
  // Windows and macOS default filesystems are case-insensitive; lowercase
  // avoids mismatches between Godot's globalize_path and Node.js
  // process.cwd() which may differ in casing.
  if (process.platform === "win32" || process.platform === "darwin") n = n.toLowerCase();
  return n;
}

/** OS-specific registry file path — must match registry_client.gd. */
export function registryPath(): string {
  switch (process.platform) {
    case "win32":
      return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "godot-mcp-toolkit", "projects.json");
    case "darwin":
      return join(homedir(), "Library", "Application Support", "godot-mcp-toolkit", "projects.json");
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
  // Retry up to 3 times on parse failure — handles the brief window
  // during two-phase atomic write where the file may be partially written.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const raw = readFileSync(registryPath(), "utf-8");
      const data = JSON.parse(raw) as Registry;
      if (data && typeof data.by_path === "object") return data;
    } catch {
      if (attempt < 2) {
        const delay = 100 * (attempt + 1);
        const start = Date.now();
        while (Date.now() - start < delay) {
          /* busy wait — rare path, tiny delay */
        }
      }
    }
  }
  return { by_path: {} };
}

/**
 * Check if a process is still alive. Returns false if provably dead.
 * Uses signal 0 (no-op) — reliable on all platforms including Windows.
 */
function isPidAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
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
 * Look up the most-recently-started project entry on a given port.
 * Filters out entries whose PID is provably dead. Returns null if no
 * live entry matches the port.
 */
export function lookupByPort(port: number): { path: string; entry: RegistryEntry } | null {
  const registry = readRegistry();
  let best: { path: string; entry: RegistryEntry } | null = null;
  for (const [path, entry] of Object.entries(registry.by_path)) {
    if (entry.port !== port) continue;
    if (!isPidAlive(entry.pid)) continue;
    if (!best || entry.started_at > best.entry.started_at) {
      best = { path, entry };
    }
  }
  return best;
}

/**
 * Return the runtime_port for a project, or null if no playtest is active.
 * Re-reads the file on every call so newly-started playtests are picked up.
 */
export function discoverRuntime(projectPath: string): number | null {
  const entry = lookupProject(projectPath);
  if (!entry) return null;
  const port = entry.runtime_port;
  if (port == null || !Number.isInteger(port) || port < 1024 || port > 65535) return null;
  return port;
}

// -- Registry watcher ----------------------------------------------------------
//
// Watches projects.json via fs.watch and fires callbacks when a project's
// runtime_port transitions (null→port, port→null, port→different port).
// Replaces per-RPC file reads with in-memory lookups when active.
//
// Safety net: a 30s stat-poll heartbeat catches silent watcher death (rare),
// inode replacement on Linux/macOS, and the file-not-yet-created case (P2).

let watcher: FSWatcher | null = null;
let cachedRegistry: Registry = { by_path: {} };
let runtimeDiscoveredCb: ((projectPath: string, port: number) => void) | null = null;
let runtimeRemovedCb: ((projectPath: string) => void) | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let lastKnownMtimeMs: number = 0;

function diffAndNotify(cached: Registry, fresh: Registry): void {
  const allKeys = new Set([...Object.keys(cached.by_path), ...Object.keys(fresh.by_path)]);

  for (const key of allKeys) {
    const oldPort = cached.by_path[key]?.runtime_port ?? null;
    const newPort = fresh.by_path[key]?.runtime_port ?? null;

    if (oldPort === newPort) continue;

    // Tear down before connect so the bridge never holds two channels
    // to the same project simultaneously (important for port-change).
    if (oldPort != null && oldPort > 0) {
      runtimeRemovedCb?.(key);
    }
    if (newPort != null && newPort > 0) {
      runtimeDiscoveredCb?.(key, newPort);
    }
  }
}

/** Debounced handler shared by fs.watch and heartbeat-triggered re-watches. */
function handleRegistryChange(): void {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    const fresh = readRegistry();
    diffAndNotify(cachedRegistry, fresh);
    cachedRegistry = fresh;
    // Sync mtime so the heartbeat doesn't re-fire for this same change.
    try {
      lastKnownMtimeMs = statSync(registryPath()).mtimeMs;
    } catch {
      /* file may have been deleted — heartbeat handles it */
    }
  }, 100);
}

function onWatchError(): void {
  watcher?.close();
  watcher = null;
}

/** Try to establish (or re-establish) fs.watch on projects.json. */
function tryStartWatcher(): boolean {
  if (watcher) return true;
  try {
    watcher = watch(registryPath(), { persistent: false }, handleRegistryChange);
    watcher.on("error", onWatchError);
    return true;
  } catch {
    return false;
  }
}

/**
 * 30s stat-poll heartbeat. Covers:
 *  - Silent watcher death (all platforms, rare)
 *  - Inode replacement on Linux/macOS (file replaced via atomic rename)
 *  - File not yet created at startup (P2) — retries watcher start
 */
function startHeartbeat(): void {
  try {
    lastKnownMtimeMs = statSync(registryPath()).mtimeMs;
  } catch {
    /* file may not exist yet */
  }

  heartbeatTimer = setInterval(() => {
    // Re-establish watcher if it died or never started (P2: ENOENT at init).
    if (!watcher) tryStartWatcher();

    try {
      const mtime = statSync(registryPath()).mtimeMs;
      if (mtime !== lastKnownMtimeMs) {
        lastKnownMtimeMs = mtime;
        // Watcher missed this change — force re-read and diff.
        const fresh = readRegistry();
        diffAndNotify(cachedRegistry, fresh);
        cachedRegistry = fresh;
      }
    } catch {
      // File gone — if we had entries, treat as full removal.
      if (Object.keys(cachedRegistry.by_path).length > 0) {
        const fresh: Registry = { by_path: {} };
        diffAndNotify(cachedRegistry, fresh);
        cachedRegistry = fresh;
      }
    }
  }, 30_000);
  heartbeatTimer.unref?.();
}

/**
 * Start watching projects.json for runtime port changes.
 *
 * Falls back silently when fs.watch is unavailable or the file doesn't
 * exist yet — isWatcherActive() returns false and callRuntime uses
 * per-RPC file reads. The heartbeat retries watcher creation every 30s.
 */
export function watchRegistry(callbacks: {
  onDiscovered: (projectPath: string, port: number) => void;
  onRemoved: (projectPath: string) => void;
}): void {
  runtimeDiscoveredCb = callbacks.onDiscovered;
  runtimeRemovedCb = callbacks.onRemoved;
  cachedRegistry = readRegistry();

  tryStartWatcher();
  startHeartbeat();
}

/** Stop watching and clean up. Safe to call even if never started. */
export function unwatchRegistry(): void {
  clearTimeout(debounceTimer);
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  watcher?.close();
  watcher = null;
}

/** True when fs.watch is active and cachedRegistry is kept fresh. */
export function isWatcherActive(): boolean {
  return watcher !== null;
}

/**
 * Read runtime_port from the in-memory cache (zero I/O).
 * Returns null if no runtime is registered or the watcher hasn't seen one.
 */
export function getCachedRuntimePort(projectPath: string): number | null {
  const key = normalizePath(projectPath);
  return cachedRegistry.by_path[key]?.runtime_port ?? null;
}
