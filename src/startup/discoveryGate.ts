/**
 * Holds a `tools/call` that names a tool not yet registered while an extension
 * discovery pass is in flight, then dispatches it.
 *
 * The eager discovery is deadline-wrapped, so the transport can connect while
 * the pass is still running (the startup reconcile joins it). The SDK answers a
 * call to an unregistered name with `Tool … not found` at once, so without this
 * gate a client that calls an extension tool first loses the race to its own
 * registration. Every other message, and a call to a registered name, passes
 * straight through.
 */
import { isJSONRPCRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

/**
 * The longest a call is held: one discovery pass's RPC budget
 * (`extensions.refresh`, then the `extensions.list` fallback, 5 s each). A call
 * still unregistered after it is dispatched and answered as before.
 */
export const DISCOVERY_HOLD_MS = 10_000;

/** What the gate reads: the live registry and the in-flight discovery pass. */
export interface DiscoveryGateDeps {
  /** Whether a tool of this name is registered now. */
  isRegistered(name: string): boolean;
  /** The running discovery pass, or undefined when none is in flight. */
  discoveryInFlight(): Promise<void> | undefined;
  /** Upper bound on a hold; defaults to {@link DISCOVERY_HOLD_MS}. */
  holdMs?: number;
}

/**
 * Wraps the transport's `onmessage`, which `server.connect()` installs, so a
 * call that races discovery waits for it. Call it right after `connect()`
 * resolves: stdio delivers input on later I/O callbacks, so no message reaches
 * the unwrapped handler first.
 *
 * @param transport - the connected transport
 * @param deps - the registry lookup and the in-flight discovery pass
 */
export function holdCallsDuringDiscovery(transport: Transport, deps: DiscoveryGateDeps): void {
  const dispatch = transport.onmessage;
  if (!dispatch) throw new Error("holdCallsDuringDiscovery: the transport is not connected");
  const holdMs = deps.holdMs ?? DISCOVERY_HOLD_MS;

  transport.onmessage = (message, extra) => {
    const pending = isJSONRPCRequest(message) && message.method === "tools/call" ? waitFor(message.params) : undefined;
    if (!pending) {
      dispatch(message, extra);
      return;
    }
    void pending.then(() => dispatch(message, extra));
  };

  function waitFor(params: unknown): Promise<void> | undefined {
    const name = (params as { name?: unknown } | undefined)?.name;
    if (typeof name !== "string" || deps.isRegistered(name)) return undefined;
    const discovery = deps.discoveryInFlight();
    if (!discovery) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, holdMs);
    });
    // A failed pass still releases the call: the SDK then answers it as before.
    return Promise.race([discovery.catch(() => {}), deadline]).finally(() => clearTimeout(timer));
  }
}
