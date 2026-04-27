/**
 * Runtime error classes. Separated from types.ts so that module remains
 * pure type/interface exports only (CR7).
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
