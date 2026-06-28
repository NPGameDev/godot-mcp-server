/**
 * Runtime error classes. Kept out of types.ts so that module stays pure
 * type/interface exports only.
 */

export class BridgeError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "BridgeError";
  }
}
