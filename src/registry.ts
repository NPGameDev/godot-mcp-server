/**
 * System-wide project registry reader.
 *
 * Mirrors the GDScript `registry_client.gd` — same file, same schema, same path
 * normalisation. The plugin writes; this module reads. Resolves a project's
 * editor / runtime / LSP endpoints by absolute path, and optionally watches the
 * registry's folder so runtime-port changes push to the bridge without per-RPC I/O.
 *
 * Reading includes deciding whether an entry's owner is still there: the plugin
 * has no reliable liveness signal of its own and prunes nothing, so entries
 * accumulate. That check is delegated to `registryLiveness` — still a read, kept
 * out of here so the socket mechanics don't blur the schema reader.
 *
 * @module
 */

import { readFileSync, watch, statSync } from "node:fs";
import type { FSWatcher } from "node:fs";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";

import { isPidAlive, wsPortNotRefused } from "./registryLiveness.js";

// -- Types -------------------------------------------------------------------

/**
 * One project's registry record, as written by the toolkit. Snake_case fields
 * mirror the GDScript schema verbatim — this module reads the file the plugin
 * owns, so the shapes must match byte-for-byte.
 */
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

/**
 * The parsed `projects.json`: every project entry, keyed by canonical path.
 *
 * @internal
 */
export interface Registry {
  by_path: Record<string, RegistryEntry>;
}

// -- Path helpers ------------------------------------------------------------

/** Canonical path form: forward slashes, no trailing slash, lowercase on Windows and macOS. */
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

/**
 * The registry as the file holds it now, or undefined when the file cannot be read.
 *
 * Single parse attempt — no retry, no busy-wait. The toolkit replaces the file by
 * rename (.tmp onto the target), so a file that can be read is complete, never
 * partial, and a parse failure is genuine corruption that re-reading the same
 * bytes cannot fix: it reads as empty. The file can still be missing, either
 * because no editor has written it yet or for the moment between the toolkit's
 * two renames, when the old file is already .bak and the new one not yet in place.
 */
function readRegistryFile(): Registry | undefined {
  let raw: string;
  try {
    raw = readFileSync(registryPath(), "utf-8");
  } catch {
    return undefined;
  }
  try {
    const data = JSON.parse(raw) as Registry;
    if (data && typeof data.by_path === "object") return data;
  } catch {
    /* corrupt file — fall through to empty. */
  }
  return { by_path: {} };
}

/** The registry, with a missing or unreadable file read as empty. */
function readRegistry(): Registry {
  return readRegistryFile() ?? { by_path: {} };
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
 * The runtime port an entry advertises, or null when the port is out of range or
 * its owning playtest process is provably dead. The runtime-port lookups (the fresh
 * file read and the watcher's cache) and the watcher's `discovered` events all go
 * through this one check, so they agree.
 */
function usableRuntimePort(entry: RegistryEntry): number | null {
  const port = entry.runtime_port;
  if (port == null || !Number.isInteger(port) || port < 1024 || port > 65535) return null;
  // Skip a port whose owning playtest process is provably dead. The toolkit has
  // no PID-based GC (OS.is_process_running is documented for this process's own
  // children only; Windows and Linux report every other editor as not running, and
  // only macOS 4.3+ answers for GUI apps), so a crashed playtest leaves runtime_port set
  // until the next register() clears it; without this gate the bridge would
  // attempt a doomed connect, or reach whatever program has taken the port
  // since. A null runtime_pid (no recorded owner) does not block.
  //
  // A live PID is all this path asks for — deliberately weaker than the LSP
  // claimant predicate below. A wrong runtime port announces itself (the connect
  // fails into a visible GAME_NOT_RUNNING, and the channel has its own
  // per-instance auth handshake), whereas a wrong LSP port silently returns
  // another project's symbols; and this runs on every runtime RPC, not once per
  // connection, so a socket probe here would tax the whole game_* surface.
  if (entry.runtime_pid != null && !isPidAlive(entry.runtime_pid)) return null;
  return port;
}

/**
 * Return the runtime_port for a project, or null if no playtest is active.
 * Re-reads the file on every call so newly-started playtests are picked up.
 */
export function discoverRuntime(projectPath: string): number | null {
  const entry = lookupProject(projectPath);
  return entry ? usableRuntimePort(entry) : null;
}

// -- LSP endpoint discovery --------------------------------------------------
//
// Godot's GDScript LSP binds one machine-wide port (default 6005); the toolkit
// publishes each editor's setting-derived endpoint into its registry entry.
// We resolve per-project and detect collisions server-side (the toolkit can't
// read whether its own bind won). See lsp/lspClient.ts (resolveLspEndpoint).

/**
 * Every editor still credibly claiming a given LSP port — all of them, not just
 * the newest.
 *
 * A claimant counts only when it is **pid-alive AND the WS command port its own
 * entry advertises does not refuse a connection**. The PID check comes first
 * because it is free and settles the provably-dead entries; the port probe is what
 * establishes *identity*, since the projection never prunes cross-project entries and
 * they all default to the same engine LSP port — so a stale entry whose recorded
 * PID has been recycled to any unrelated process would otherwise resurrect a
 * closed editor as a rival claimant. An inconclusive probe leaves the claimant
 * counted — `registryLiveness.classifyProbeOutcome` carries why that direction is
 * the safe one. Probes run concurrently, so the added latency is one round trip,
 * not one per candidate.
 */
export async function liveLspClaimants(port: number): Promise<Array<{ path: string; entry: RegistryEntry }>> {
  const registry = readRegistry();
  const candidates: Array<{ path: string; entry: RegistryEntry }> = [];
  for (const [path, entry] of Object.entries(registry.by_path)) {
    if (entry.lsp_port !== port) continue;
    if (!isPidAlive(entry.pid)) continue;
    candidates.push({ path, entry });
  }
  const notRefused = await Promise.all(candidates.map((c) => wsPortNotRefused(c.entry.port)));
  return candidates.filter((_, i) => notRefused[i]);
}

/**
 * Resolve this project's published LSP endpoint, with conservative ownership.
 *   { host, port } — we own it: connect (then verify rootUri on 4.5+).
 *   { conflict, port } — a corroborated peer started at-or-before us holds the port.
 *   null — no usable entry; the caller applies the miss rule (conditional 6005).
 *
 * Connect only if strictly the EARLIEST corroborated claimant: the engine gives
 * the port to whoever listen()s first, and started_at is a safe proxy for starts
 * >~1s apart. A genuine same-second tie fails BOTH sides — never wrong data.
 */
export async function discoverLspEndpoint(
  projectPath: string,
): Promise<{ host: string; port: number } | { conflict: true; port: number } | null> {
  const entry = lookupProject(projectPath);
  if (!entry || entry.lsp_port == null) return null;
  const port = entry.lsp_port;
  const claimants = await liveLspClaimants(port);
  const peers = claimants.filter((c) => c.entry.pid !== entry.pid);
  if (peers.some((c) => c.entry.started_at <= entry.started_at)) return { conflict: true, port };
  return { host: entry.lsp_host ?? "127.0.0.1", port };
}

// -- Registry watcher ----------------------------------------------------------
//
// Watches the folder that holds projects.json and fires callbacks when a
// project's (runtime_port, runtime_pid) pair changes (see runtimeTransitions).
// Replaces per-RPC file reads with in-memory lookups when active.
//
// The folder, not the file: the toolkit replaces projects.json by rename on every
// write, and on Linux and macOS a watch on the file follows the replaced inode and
// goes quiet after the first replacement. The folder outlives every replacement,
// and it also reports the file's first creation.
//
// Safety net: a 30s stat-poll heartbeat catches silent watcher death (rare) and
// retries the watch while the folder does not exist yet.

let watcher: FSWatcher | undefined = undefined;
let cachedRegistry: Registry = { by_path: {} };
let runtimeDiscoveredCb: ((projectPath: string, port: number) => void) | undefined = undefined;
let runtimeRemovedCb: ((projectPath: string) => void) | undefined = undefined;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let heartbeatTimer: ReturnType<typeof setInterval> | undefined = undefined;
let lastKnownMtimeMs: number = 0;

/**
 * One watcher event for a project's runtime, keyed by the project's canonical
 * path: `removed` means its previous runtime port is gone, `discovered` carries the
 * usable port to connect to.
 *
 * @internal
 */
export type RuntimeTransition = { kind: "removed"; key: string } | { kind: "discovered"; key: string; port: number };

/**
 * The events a registry change owes the runtime connection, in the order to apply
 * them. A project transitions when its (runtime_port, runtime_pid) pair changes:
 * the runtime band always scans from the same port, so a relaunched game often
 * returns the same port under a new pid. `removed` is reported for any previous
 * port; `discovered` only for a port `usableRuntimePort` accepts, so a game whose
 * recorded pid is dead is never announced as ready. An absent pid compares as null,
 * so a toolkit that records none transitions on the port alone. Reads no file and
 * starts no timer; the only outside look is the pid-liveness probe.
 *
 * @internal Exported for the unit tests.
 */
export function runtimeTransitions(cached: Registry, fresh: Registry): RuntimeTransition[] {
  const events: RuntimeTransition[] = [];
  const allKeys = new Set([...Object.keys(cached.by_path), ...Object.keys(fresh.by_path)]);

  for (const key of allKeys) {
    const oldEntry = cached.by_path[key];
    const newEntry = fresh.by_path[key];
    const oldPort = oldEntry?.runtime_port ?? null;
    const newPort = newEntry?.runtime_port ?? null;
    if (oldPort === newPort && (oldEntry?.runtime_pid ?? null) === (newEntry?.runtime_pid ?? null)) continue;

    if (oldPort != null && oldPort > 0) {
      events.push({ kind: "removed", key });
    }
    const usablePort = newEntry ? usableRuntimePort(newEntry) : null;
    if (usablePort != null) {
      events.push({ kind: "discovered", key, port: usablePort });
    }
  }
  return events;
}

function diffAndNotify(cached: Registry, fresh: Registry): void {
  // Events arrive remove-before-discover per project, so the bridge never holds
  // two channels to the same project at once (important for a port or pid change).
  for (const event of runtimeTransitions(cached, fresh)) {
    if (event.kind === "removed") {
      runtimeRemovedCb?.(event.key);
    } else {
      runtimeDiscoveredCb?.(event.key, event.port);
    }
  }
}

/** Debounced handler for the folder watch's projects.json events. */
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
  watcher = undefined;
}

/**
 * Try to establish (or re-establish) fs.watch on the registry folder. Fails while
 * the folder does not exist; the toolkit creates it, never this reader.
 */
function tryStartWatcher(): boolean {
  if (watcher) return true;
  const path = registryPath();
  const fileName = basename(path);
  try {
    // The folder also holds the toolkit's .tmp, .bak and .lock siblings, which change
    // on every write; only projects.json counts. Node may report no filename, so a
    // missing name counts as a change.
    watcher = watch(dirname(path), { persistent: false }, (_event, name) => {
      if (name == null || name === fileName) handleRegistryChange();
    });
    watcher.on("error", onWatchError);
    return true;
  } catch {
    return false;
  }
}

/**
 * 30s stat-poll heartbeat. Covers:
 *  - Silent watcher death (all platforms, rare)
 *  - A registry folder that does not exist yet — retries the watcher start
 */
function startHeartbeat(): void {
  try {
    lastKnownMtimeMs = statSync(registryPath()).mtimeMs;
  } catch {
    /* file may not exist yet */
  }

  heartbeatTimer = setInterval(() => {
    // Re-establish the watcher if it died or never started (no registry folder at start).
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
 * Watches the folder that holds the file, so a registry the toolkit replaces or
 * creates later is still seen. Falls back silently when fs.watch is unavailable or
 * the folder doesn't exist yet — isWatcherActive() returns false and callRuntime
 * uses per-RPC file reads. The heartbeat retries watcher creation every 30s.
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
    heartbeatTimer = undefined;
  }
  watcher?.close();
  watcher = undefined;
}

/**
 * Read projects.json once and report its runtime changes through the callbacks
 * {@link watchRegistry} was given, as a watch event would. For a caller that is
 * waiting on a runtime and cannot afford a missed watch event; it runs no timer of
 * its own.
 *
 * @remarks
 * A no-op unless {@link watchRegistry} is running. Re-arms the watch when none is
 * attached. A file that cannot be read (missing, as between the toolkit's two
 * renames, or otherwise unreadable) reports nothing, so a removal is left to the
 * watch and the heartbeat; a corrupt one reads as empty, as the watch reads it.
 *
 * @internal
 */
export function recheckRegistry(): void {
  if (heartbeatTimer === undefined) return;
  tryStartWatcher();
  let mtimeMs: number;
  try {
    // Stat before the read: a replacement that lands in between costs the heartbeat
    // one redundant re-read, where stat-after-read would let it skip that change.
    mtimeMs = statSync(registryPath()).mtimeMs;
  } catch {
    return;
  }
  const fresh = readRegistryFile();
  if (fresh === undefined) return;
  diffAndNotify(cachedRegistry, fresh);
  cachedRegistry = fresh;
  lastKnownMtimeMs = mtimeMs;
}

/** True when fs.watch is active and cachedRegistry is kept fresh. */
export function isWatcherActive(): boolean {
  return watcher !== undefined;
}

/**
 * Read runtime_port from the in-memory cache, with no file read.
 * Returns null if no runtime is registered or the watcher hasn't seen one, and,
 * as {@link discoverRuntime} does, for an out-of-range port or a dead owning process.
 */
export function getCachedRuntimePort(projectPath: string): number | null {
  const entry = cachedRegistry.by_path[normalizePath(projectPath)];
  return entry ? usableRuntimePort(entry) : null;
}
