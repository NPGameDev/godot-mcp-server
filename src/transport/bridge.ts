/**
 * Transport bridge — the editor-side WebSocket facade the whole server calls
 * through. {@link createBridge} returns the single {@link Bridge} the tool layer
 * uses to reach the running Godot editor (and, lazily, the playtest runtime): it
 * drives the auth handshake, the connected-version lifecycle, editor-port
 * re-discovery on disconnect, and delegation of the runtime channel.
 *
 * @remarks
 * The bridge is the reference implementation of the project's async discipline —
 * every call it forwards is timeout-bounded and cancellation-aware. Project-hash,
 * token path, and WS framing are cross-repo contract with the toolkit; changing
 * them is a contract change (docs/dev/contract.md in the toolkit repo), not a
 * free refactor.
 *
 * @module
 */
import { Bridge, NotificationHandler } from "../shared/types.js";
import { BridgeError } from "../shared/errors.js";
import { createChannel, type Channel } from "./channel.js";
import { createRuntimeConnection } from "./runtimeConnection.js";
import { parseGodotVer } from "../shared/version.js";
import type { GodotVer } from "../shared/version.js";
import { lookupProject } from "../registry.js";

// Re-exported from types.ts so the public bridge surface stays byte-stable for
// importers of "./bridge.js".
export type { NotificationHandler } from "../shared/types.js";

// Re-exported from authHandshake.ts so the public bridge surface stays
// byte-stable for importers of "./bridge.js".
export type { AuthResponse } from "./authHandshake.js";

// ── Public bridge factory ────────────────────────────────────────────

/** Options for bridge creation. */
export interface BridgeOptions {
  /** Absolute path to the Godot project. Used for registry-based port
   *  discovery (editor + runtime). Falls back to CWD if not set. */
  projectPath?: string;
  /** If set, bypass registry and use this static port for Mode B. */
  explicitRuntimePort?: string | undefined;
  /** When true, editor URL is a pin (GODOT_MCP_EDITOR_PORT / --editor-port set).
   *  Skips registry re-discovery on editor connection loss and, on a pinned
   *  connect or auth-handshake failure, runs the fail-fast desync cross-check. */
  explicitEditorPort?: boolean;
  /** Max bytes for script content responses (sent to plugin via meta.set_limits). */
  scriptReadLimitBytes?: number;
  /** Max WebSocket buffer size in bytes (sent to plugin via meta.set_limits). */
  wsBufferLimitBytes?: number;
}

/**
 * Build the bridge for one Godot project. Connection is lazy — the first
 * {@link Bridge.call} performs the WebSocket connect + auth handshake; the runtime
 * channel connects on demand when a playtest is discovered.
 *
 * @param editorUrl - the editor WebSocket URL (`ws://127.0.0.1:<port>`); the port
 *   is re-discovered from the registry on disconnect unless `explicitEditorPort` is
 *   set or the project path is unknown
 * @param opts - see {@link BridgeOptions}: project path for registry discovery,
 *   static-port overrides, and the response/buffer caps pushed to the plugin after auth
 * @returns the {@link Bridge}, augmented with `onNotification` (unsolicited plugin
 *   pushes) and `onGodotVersionKnown` (fires once on the unknown → known version
 *   transition, so the composition root can complete a tool surface registered
 *   before the editor reported its version)
 */
export function createBridge(
  editorUrl: string,
  opts?: BridgeOptions,
): Bridge & {
  onNotification(handler: NotificationHandler): void;
  /** Register a one-shot-friendly hook fired when the connected Godot version
   *  resolves (unknown → known). The composition root uses it to complete an
   *  incomplete startup tool surface. */
  onGodotVersionKnown(handler: () => void): void;
} {
  const projectPath = opts?.projectPath;
  let godotVersion: string | undefined = undefined;
  // Editor display mode from the Mode-A auth ack. undefined until the editor
  // authenticates — mirrors godotVersion's unknown state, and NOT pre-populated
  // from the registry (no pre-auth consumer; the registry carries no display mode).
  let headless: boolean | undefined = undefined;
  let notificationHandler: NotificationHandler | undefined = undefined;
  let versionKnownHandler: (() => void) | undefined = undefined;

  // Record the connected Godot version. Fires the version-resolved hook on the
  // unknown → known transition (and only then) so the composition root can
  // complete a tool surface that was registered before the editor reported its
  // version — version-gated tools (scene_close) and extension tools stranded on
  // a server-before-editor cold start. Routing every version-set
  // site through here keeps the unknown → known lifecycle owned in one place.
  function setGodotVersion(v: string): void {
    const versionWasUnknown = godotVersion == null;
    godotVersion = v;
    if (versionWasUnknown && versionKnownHandler) versionKnownHandler();
  }

  // Pre-populate version from registry entry (available before auth).
  if (projectPath) {
    const regEntry = lookupProject(projectPath);
    if (regEntry) {
      const regVer = regEntry.godot_version;
      if (regVer != null && regVer.length > 0) {
        godotVersion = regVer;
      }
    }
  }

  // After auth, push server-side response caps to the plugin so it can
  // enforce them (server env var > dock UI ProjectSettings > defaults).
  function sendLimitsIfConfigured(channel: Channel): void {
    const scriptKb = opts?.scriptReadLimitBytes ? Math.round(opts.scriptReadLimitBytes / 1024) : 0;
    const wsKb = opts?.wsBufferLimitBytes ? Math.round(opts.wsBufferLimitBytes / 1024) : 0;
    if (scriptKb > 0 || wsKb > 0) {
      const params: Record<string, number> = {};
      if (scriptKb > 0) params.script_read_cap_kb = scriptKb;
      if (wsKb > 0) params.ws_buffer_kb = wsKb;
      // Fire-and-forget — failure here is non-fatal.
      void channel.call("meta.set_limits", params, 5000).catch(() => {});
    }
  }

  const getNotificationHandler = () => notificationHandler;
  let editor = createChannel(
    editorUrl,
    projectPath,
    ({ version, headless: h }) => {
      setGodotVersion(version);
      headless = h;
      sendLimitsIfConfigured(editor);
    },
    getNotificationHandler,
  );
  let cachedEditorPort = Number(new URL(editorUrl).port);

  // ── Editor-port re-discovery ─────────────────────────────────────
  // When the editor channel fails with CONNECT_FAILED / DISCONNECTED,
  // re-read the registry. If the port changed (plugin restarted on a
  // different port), close the old channel, create a fresh one, and
  // retry the call once. Skipped when the editor port is a pin
  // (GODOT_MCP_EDITOR_PORT / --editor-port) or no projectPath is available for
  // registry lookup. TTL prevents thrashing the registry file when the editor
  // is truly unreachable.
  const staticEditor = !!opts?.explicitEditorPort;
  const EDITOR_REDISCOVER_TTL_MS = 5_000;
  let lastRediscoverAt = 0;

  async function rediscoverEditor(): Promise<boolean> {
    if (staticEditor || !projectPath) return false;
    const now = Date.now();
    if (now - lastRediscoverAt < EDITOR_REDISCOVER_TTL_MS) return false;
    lastRediscoverAt = now;
    const entry = lookupProject(projectPath);
    if (!entry) return false;
    if (entry.port === cachedEditorPort) return false;
    const oldPort = cachedEditorPort;
    cachedEditorPort = entry.port;
    await editor.close();
    editor = createChannel(
      `ws://127.0.0.1:${cachedEditorPort}`,
      projectPath,
      ({ version, headless: h }) => {
        setGodotVersion(version);
        headless = h;
      },
      getNotificationHandler,
    );
    process.stderr.write(`[bridge] editor port changed ${oldPort} → ${cachedEditorPort}\n`);
    return true;
  }

  // ── Fail-fast desync cross-check (pinned editor) ─────────────────
  // A pinned editor port skips re-discovery, so a stale or unsynced pin (the
  // classic ".mcp.json sets the pin for the server only, the editor is launched
  // separately" case) would otherwise surface only as a generic error. Two
  // failure shapes reach here: a connection-level loss (nothing on the pinned
  // port), and a FAILED AUTH HANDSHAKE — a foreign WebSocket server on the
  // pinned port passes the TCP+WS upgrade and then stalls or drops the auth, so
  // the desync surfaces as AUTH_FAILED, never CONNECT_FAILED. For either, read
  // the registry ONCE — the toolkit publishes its real bound port even in pin
  // mode — and synthesize a precise, actionable error naming the mismatch,
  // PRESERVING the original transport code (retry semantics stay intact).
  // Registry I/O stays on the FAILURE path only; the healthy path never reads
  // it. Returns undefined when there is nothing to add — no projectPath for
  // ground truth, or an auth failure with the registry AGREEING on the port
  // (the real editor answered and rejected auth: a token problem, not a port
  // desync) — leaving the original error to propagate.
  function pinnedEditorDesyncError(original: BridgeError): BridgeError | undefined {
    if (!projectPath) return undefined;
    const authFailure = original.code === "AUTH_FAILED";
    const entry = lookupProject(projectPath);
    if (!entry) {
      return new BridgeError(
        original.code,
        authFailure
          ? `auth failed on pinned editor port ${cachedEditorPort} and no live editor is registered for this ` +
              `project — something else may be occupying the pinned port; launch the Godot editor with ` +
              `GODOT_MCP_EDITOR_PORT=${cachedEditorPort} so it binds the same port, or unset the pin to use ` +
              `registry discovery`
          : `editor pinned to port ${cachedEditorPort}, but no live editor is registered for this project — ` +
              `launch the Godot editor (set GODOT_MCP_EDITOR_PORT=${cachedEditorPort} so it binds the same port), ` +
              `or unset the pin to use registry discovery`,
      );
    }
    if (entry.port !== cachedEditorPort) {
      return new BridgeError(
        original.code,
        authFailure
          ? `auth failed on pinned editor port ${cachedEditorPort}, but the live editor for this project is ` +
              `listening on ${entry.port} — something else may be occupying the pinned port; launch the editor ` +
              `with the same GODOT_MCP_EDITOR_PORT, or unset the pin to use discovery`
          : `editor pinned to port ${cachedEditorPort}, but the live editor for this project is listening on ` +
              `${entry.port} — launch the editor with the same GODOT_MCP_EDITOR_PORT, or unset the pin to use discovery`,
      );
    }
    // Registry agrees with the pin. An auth failure here came from the real
    // editor (token trouble, not a desync) — add nothing. A connection loss
    // means the editor is down, restarting, or crashed — say so plainly.
    if (authFailure) return undefined;
    return new BridgeError(
      original.code,
      `editor pinned to port ${cachedEditorPort} matches the registry, but the port is not accepting ` +
        `connections — the editor may be starting or has stopped`,
    );
  }

  // ── Runtime connection ───────────────────────────────────────────
  // The playtest runtime-connection aggregate — discovery, the registry
  // watcher, port-waiters, and the frozen-game heartbeat — lives in
  // runtimeConnection.ts. The composition root builds one and delegates the
  // runtime facade methods (callRuntime / waitForRuntimeConnection /
  // clearRuntime) to it. It touches neither version state nor notifications.
  const runtime = createRuntimeConnection({ projectPath, explicitRuntimePort: opts?.explicitRuntimePort });

  return {
    async call(method, params, timeoutMs, signal) {
      try {
        return await editor.call(method, params, timeoutMs, signal);
      } catch (err) {
        if (err instanceof BridgeError) {
          const connectionLoss = err.code === "CONNECT_FAILED" || err.code === "DISCONNECTED";
          if (staticEditor) {
            // Pinned: no re-discovery. A connection loss OR a failed auth
            // handshake (a foreign server on the pinned port) gets the desync
            // diagnosis (one registry read, on the failure path only).
            if (connectionLoss || err.code === "AUTH_FAILED") {
              const desync = pinnedEditorDesyncError(err);
              if (desync) throw desync;
            }
          } else if (connectionLoss) {
            // On editor connection failure, re-read the registry. If the port
            // changed, retry once against the new channel.
            const changed = await rediscoverEditor();
            if (changed) return editor.call(method, params, timeoutMs, signal);
          }
        }
        throw err;
      }
    },
    callRuntime(method, params, timeoutMs, signal) {
      return runtime.callRuntime(method, params, timeoutMs, signal);
    },
    async close() {
      // Runtime first: tearing it down resolves any outstanding port-waiters
      // and stops the heartbeat/watcher before either socket closes. The editor
      // and runtime are independent sockets, so their relative close order is
      // unobservable.
      await runtime.close();
      await editor.close();
    },
    getGodotVersionString() {
      return godotVersion;
    },
    getGodotVersion(): GodotVer | undefined {
      if (!godotVersion) return undefined;
      return parseGodotVer(godotVersion);
    },
    isHeadless(): boolean | undefined {
      return headless;
    },
    waitForRuntimeConnection(timeoutMs: number): Promise<{ port: number } | undefined> {
      return runtime.waitForRuntimeConnection(timeoutMs);
    },
    clearRuntime() {
      runtime.clearRuntime();
    },
    onNotification(handler: NotificationHandler) {
      notificationHandler = handler;
    },
    onGodotVersionKnown(handler: () => void) {
      versionKnownHandler = handler;
    },
  };
}
