/**
 * Unit tests for errors.ts — the BridgeError class: code/message/name wiring,
 * the Error/BridgeError instanceof chain, throw/catch round-trip, and the
 * arbitrary-string-code contract (transport codes outside the ErrorCode union).
 */
import assert from "node:assert/strict";
import { BridgeError } from "../../src/shared/errors.js";

// ── Construction wires code, message, and name ───────────────────────

{
  const err = new BridgeError("TIMEOUT", "timed out after 5s");
  assert.equal(err.code, "TIMEOUT");
  assert.equal(err.message, "timed out after 5s");
  assert.equal(err.name, "BridgeError");
}

// ── instanceof chain + populated stack ───────────────────────────────

{
  const err = new BridgeError("INTERNAL", "boom");
  assert.ok(err instanceof Error);
  assert.ok(err instanceof BridgeError);
  assert.equal(typeof err.stack, "string");
  assert.ok((err.stack as string).length > 0);
}

// ── throw/catch round-trip preserves type + code ─────────────────────

{
  let caught: unknown;
  try {
    throw new BridgeError("CONNECT_FAILED", "no socket");
  } catch (e: unknown) {
    caught = e;
  }
  assert.ok(caught instanceof BridgeError);
  assert.equal((caught as BridgeError).code, "CONNECT_FAILED");
}

// ── Arbitrary string code accepted (transport codes not in ErrorCode) ─

{
  const err = new BridgeError("RPC_ERROR", "remote method failed");
  assert.equal(err.code, "RPC_ERROR");
  // A non-canonical, free-form code is preserved verbatim (the constructor
  // types `code` as a plain string — the bridge passes transport codes through).
  const free = new BridgeError("SOME_UNLISTED_CODE", "whatever");
  assert.equal(free.code, "SOME_UNLISTED_CODE");
}

// ── serializedQueueTimeout marker defaults false and is settable ──────

{
  const err = new BridgeError("TIMEOUT", "queued then timed out");
  assert.equal(err.serializedQueueTimeout, false);
  err.serializedQueueTimeout = true;
  assert.equal(err.serializedQueueTimeout, true);
}

console.log("All errors tests passed.");
