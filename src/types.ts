export interface Bridge {
  call(method: string, params?: unknown, timeoutMs?: number): Promise<unknown>;
  close(): Promise<void>;
}

export class BridgeError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "BridgeError";
  }
}
