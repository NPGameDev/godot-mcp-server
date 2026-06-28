/**
 * A generic, bridge-agnostic liveness primitive: a self-stopping interval that
 * probes a resource, counts consecutive failures, and runs the owner's teardown
 * after a threshold. It knows nothing of channels, ports, or the runtime — the
 * resource-specific bits (the probe, the liveness check, the teardown) are
 * injected through `ping`/`isAlive`/`onDead`, so the timer policy is
 * unit-testable in isolation and reusable. The bridge composes it as the
 * frozen-game detector for the playtest runtime channel.
 */

/** A self-managing liveness timer. */
export interface Heartbeat {
  /** Idempotent single-flight: arms the interval and resets the failure
   *  counter. A second call while already running is a no-op (one interval). */
  start(): void;
  /** Clears the interval and resets the failure counter. Safe to call when
   *  already stopped. */
  stop(): void;
}

/**
 * Build a liveness heartbeat. On each tick — before probing — it checks
 * `isAlive`: a false result stops the timer and skips the probe with NO failure
 * increment (the load-bearing self-stop guard for a resource that vanished
 * out-of-band). Otherwise it `await`s `ping`; a resolve resets the
 * consecutive-failure counter, a reject increments it, and reaching
 * `maxFailures` fires `onDead` once (the owner's teardown) then stops.
 */
export function createHeartbeat(opts: {
  /** One liveness probe. Resolve = alive (resets the consecutive-failure
   *  counter); reject = one failure. The probe OWNS its own timeout (the
   *  runtime injects `() => channel.call("ping", null, 10_000)`), so this
   *  primitive runs NO timeout race of its own — adding one would double the
   *  timeout. */
  ping: () => Promise<unknown>;
  /** Checked at the TOP of every tick, before ping. false ⇒ stop()+skip, with
   *  NO failure increment — the verbatim map of the inline
   *  `if (!runtimeChannel) { stopHeartbeat(); return; }` self-stop guard. */
  isAlive: () => boolean;
  /** Fired ONCE when consecutive failures reach maxFailures, BEFORE the
   *  internal stop(). The owner does its teardown here (e.g. close + null the
   *  channel/port). */
  onDead: () => void;
  /** Tick cadence, in milliseconds. */
  intervalMs: number;
  /** Consecutive failures that trip onDead + stop. */
  maxFailures: number;
}): Heartbeat {
  const { ping, isAlive, onDead, intervalMs, maxFailures } = opts;

  // Closure state, constructed per primitive (no module-level mutable).
  let interval: NodeJS.Timeout | undefined = undefined;
  let failures = 0;

  function start(): void {
    if (interval) return;
    failures = 0;
    interval = setInterval(async () => {
      if (!isAlive()) {
        stop();
        return;
      }
      try {
        await ping();
        failures = 0;
      } catch {
        failures++;
        if (failures >= maxFailures) {
          onDead();
          stop();
        }
      }
    }, intervalMs);
    interval.unref?.();
  }

  function stop(): void {
    if (interval) {
      clearInterval(interval);
      interval = undefined;
    }
    failures = 0;
  }

  return { start, stop };
}
