/**
 * Liveness corroboration for registry entries.
 *
 * Answers one question about a `projects.json` entry: is the process it recorded
 * still the editor that wrote it? A PID existence check alone cannot say — PIDs
 * are a bounded, recycled resource, so a dead editor's leftover entry looks live
 * the moment its number is handed to some unrelated process. The corroboration is
 * the entry's own advertised WebSocket command port: a closed editor is not
 * listening there, and a recycled PID cannot fake it.
 *
 * Deliberately knows nothing about the registry schema — it takes plain numbers,
 * so the reader depends on it and never the reverse.
 *
 * @module
 */

import { createConnection } from "node:net";

/** The toolkit's WebSocket command server binds loopback only. */
const PROBE_HOST = "127.0.0.1";

/**
 * Corroboration probe budget. A loopback `ECONNREFUSED` returns in single-digit
 * milliseconds, so this is ~30x headroom that still bounds the worst case: the
 * probe sits on the once-per-connection LSP resolution path.
 */
const PROBE_TIMEOUT_MS = 300;

/**
 * Whether a process is still alive. Returns false only if provably dead.
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
 *
 * A live PID proves only that *some* signalable process holds that number — not
 * that it is a Godot editor, and not that it is the editor of record. Pair it
 * with {@link wsPortNotRefused} whenever identity matters.
 */
export function isPidAlive(pid: number): boolean {
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
 * The fail-closed policy for a corroboration probe, as a pure decision.
 *
 * `ECONNREFUSED` is the only positive proof of refusal — nothing is listening, so
 * the editor that advertised the port is gone. Every other outcome (a timeout, a
 * local resource limit, an unrecognised code) says nothing about the peer, and
 * the two failure directions are not symmetric: treating an inconclusive probe as
 * proof of death would drop a genuine rival and silently serve another project's
 * data on Godot 4.2–4.4, which have no root-mismatch backstop. Calling it
 * indeterminate keeps the peer counted, which is at worst today's visible
 * behaviour — never worse.
 *
 * @param code the socket error's `code`, or undefined when the probe timed out
 */
export function classifyProbeOutcome(code: string | undefined): "dead" | "indeterminate" {
  return code === "ECONNREFUSED" ? "dead" : "indeterminate";
}

/**
 * Whether a connection to `port` was **not** positively refused.
 *
 * Named for what it actually establishes. `false` means `ECONNREFUSED` — proof the
 * advertised port has no listener. `true` lumps a successful connect together with
 * every inconclusive outcome ({@link classifyProbeOutcome}), and a port outside the
 * connectable range cannot be probed at all, so `true` is the *absence of proof of
 * death*, never proof of life. Reading it as "the port answered" would invert the
 * fail-closed policy this predicate exists to implement.
 *
 * The socket closes with a graceful FIN rather than a reset: the toolkit wraps
 * every accepted stream in a `WebSocketPeer` and logs `accept_stream failed` when
 * the stream dies before the wrap, which would put probe noise in a real editor's
 * Output dock.
 */
export function wsPortNotRefused(port: number): Promise<boolean> {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    const socket = createConnection({ host: PROBE_HOST, port });
    let settled = false;
    const settle = (responds: boolean, graceful: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (graceful) socket.end();
      else socket.destroy();
      resolve(responds);
    };
    const timer = setTimeout(() => settle(true, false), PROBE_TIMEOUT_MS);
    socket.on("connect", () => settle(true, true));
    // Listen (not once) so a late error after settling is absorbed here instead
    // of surfacing as an unhandled 'error' event.
    socket.on("error", (err: NodeJS.ErrnoException) => settle(classifyProbeOutcome(err.code) !== "dead", false));
  });
}
