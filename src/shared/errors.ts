/**
 * Runtime error classes. Kept out of types.ts so that module stays pure
 * type/interface exports only.
 */

export class BridgeError extends Error {
  /**
   * Set on a TIMEOUT that fired after the toolkit acknowledged the call with a
   * `_queued` progress notification but before it ran (`_executing`) — i.e. the
   * call was serialized behind other scene mutations and exhausted its window
   * while waiting its fair-FIFO turn, not because the editor stalled. Lets the
   * error mapper steer to a serialization-specific hint while the transport
   * `code` stays TIMEOUT (contract-neutral).
   */
  serializedQueueTimeout = false;

  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "BridgeError";
  }
}
