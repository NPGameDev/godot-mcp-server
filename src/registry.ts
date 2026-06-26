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
  godot_version?: string;
  // GDScript LSP endpoint this editor's setting points at (published by the
  // toolkit; null when no editor resolved it — e.g. a runtime-only self-heal entry).
  lsp_port?: number | null;
  lsp_host?: string;
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
  // Single parse attempt — no retry, no busy-wait. The toolkit writes the
  // registry atomically (.tmp → rename, atomic on POSIX *and* Windows), so a
  // reader always sees a complete prior-or-new file, never a partial one. A
  // parse failure is therefore genuine corruption that re-reading the same
  // bytes cannot fix, and a missing file (ENOENT, first run) is the expected
  // "no registry yet" state. Either way we degrade gracefully to empty.
  try {
    const raw = readFileSync(registryPath(), "utf-8");
    const data = JSON.parse(raw) as Registry;
    if (data && typeof data.by_path === "object") return data;
  } catch {
    /* ENOENT (no registry yet) or corrupt file — fall through to empty. */
  }
  return { by_path: {} };
}

/**
 * Check if a process is still alive. Returns false only if provably dead.
 *
 * Signal 0 is a no-op "existence probe" — never delivered, it only tests whether
 * the process exists and is signalable. Reliable on Linux, macOS AND Windows
 * (Node/libuv maps it to OpenProcess on Windows, not the unreliable mechanism
 * behind GDScript's OS.is_process_running). Outcomes:
 *   - success            → the process exists                          → ALIVE
 *   - throw ESRCH        → no such process                             → dead
 *   - throw EPERM/EACCES → the process EXISTS but we may not signal it
 *                          (another user / elevated / protected)       → ALIVE
 *
 * Treating EPERM/EACCES as alive is the POSIX-standard robust check (`kill(pid,0)`
 * sets EPERM precisely *because* the target exists). It never triggers for our
 * same-user sibling editors, but it keeps a cross-user/elevated peer from being
 * mis-counted as dead on any platform.
 */
function isPidAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === "EPERM" || code === "EACCES";
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
  const port = entry.runtime_port;
  if (port == null || !Number.isInteger(port) || port < 1024 || port > 65535) return null;
  // Skip a port whose owning playtest process is provably dead. The toolkit has
  // no PID-based GC (OS.is_process_running is unreliable on Windows), so a
  // crashed playtest leaves runtime_port set until the next register() clears
  // it; without this gate the bridge would attempt a doomed connect. Mirrors
  // liveLspClaimants' dead-PID filter. A null runtime_pid (no recorded owner)
  // does not block — behavior is unchanged for entries without a pid.
  if (entry.runtime_pid != null && !isPidAlive(entry.runtime_pid)) return null;
  return port;
}

// -- LSP endpoint discovery --------------------------------------------------
//
// Godot's GDScript LSP binds one machine-wide port (default 6005); the toolkit
// publishes each editor's setting-derived endpoint into its registry entry.
// We resolve per-project and detect collisions server-side (the toolkit can't
// read whether its own bind won). See ADR 0008 (toolkit) / lsp_client.ts.

/**
 * Every LIVE editor claiming a given LSP port. Matches entry.lsp_port and
 * returns all claimants (not just the newest). Dead PIDs are filtered via
 * process.kill(pid, 0) — reliable on Windows, unlike the toolkit's
 * OS.is_process_running.
 */
export function liveLspClaimants(port: number): Array<{ path: string; entry: RegistryEntry }> {
  const registry = readRegistry();
  const out: Array<{ path: string; entry: RegistryEntry }> = [];
  for (const [path, entry] of Object.entries(registry.by_path)) {
    if (entry.lsp_port !== port) continue;
    if (!isPidAlive(entry.pid)) continue;
    out.push({ path, entry });
  }
  return out;
}

/**
 * Resolve this project's published LSP endpoint, with conservative ownership.
 *   { host, port } — we own it: connect (then verify rootUri on 4.5+).
 *   { conflict, port } — a live peer started at-or-before us holds the port.
 *   null — no usable entry; the caller applies the miss rule (conditional 6005).
 *
 * Connect only if strictly the EARLIEST live claimant: the engine gives the port
 * to whoever listen()s first, and started_at is a safe proxy for starts >~1s
 * apart. A genuine same-second tie fails BOTH sides — never wrong data.
 */
export function discoverLspEndpoint(
  projectPath: string,
): { host: string; port: number } | { conflict: true; port: number } | null {
  const entry = lookupProject(projectPath);
  if (!entry || entry.lsp_port == null) return null;
  const port = entry.lsp_port;
  const peers = liveLspClaimants(port).filter((c) => c.entry.pid !== entry.pid);
  if (peers.some((c) => c.entry.started_at <= entry.started_at)) return { conflict: true, port };
  return { host: entry.lsp_host ?? "127.0.0.1", port };
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
